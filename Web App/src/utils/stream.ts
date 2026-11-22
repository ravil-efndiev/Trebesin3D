import { config } from "./config.ts";
import { createFramePacket, parseServerMessage } from "./protocol.ts";
import type { StreamOptions, StreamSocket } from "./types.ts";

export const createFrameStream = ({ url, capture, scheduleFrame, onStatus, onTracking, onSelectReceipt, checkHealth, createSocket = (address) => new WebSocket(address) }: StreamOptions) => {
  let stopped = false;
  let socket: StreamSocket | null = null;
  let consecutiveRejections = 0;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseConnection = () => {};
  let healthAbort: AbortController | null = null;
  let healthTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(healthTimer);
    healthAbort?.abort();
    releaseConnection();
  };

  const fail = (message: string) => {
    stop();
    onStatus({ phase: "error", message });
  };

  const openConnection = () => {
    if (stopped) return;

    let connection: StreamSocket;

    try {
      connection = createSocket(url);
    } catch {
      fail("Could not create the WebSocket connection. Check the service URL.");
      return;
    }

    socket = connection;
    const abort = new AbortController();
    const requestId = crypto.randomUUID();
    let streamId: string | null = null;
    let nextFrameId = 1;
    let pendingFrameId: number | null = null;
    let nextCaptureAt = 0;
    let lastCaptureAt = 0;
    let lastTimestamp = -1;
    let frameWidth = 0;
    let frameHeight = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const clearTracking = () => {
      clearTimeout(expiry);
      onTracking?.(null);
    };
    let released = false;
    let cancelCapture: (() => void) | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => !stopped && socket === connection;

    releaseConnection = () => {
      if (released) return;

      released = true;
      clearTracking();
      socket = null;
      cancelCapture?.();
      clearTimeout(deadline);
      abort.abort();
      connection.onopen = null;
      connection.onmessage = null;
      connection.onclose = null;
      connection.onerror = null;

      try {
        if (connection.readyState === WebSocket.OPEN && streamId && connection.bufferedAmount === 0) {
          connection.send(JSON.stringify({ type: "stream:stop", requestId: crypto.randomUUID(), streamId }));
        }
      } catch {
        // Stop is best effort; disconnect must also release server resources.
      }

      connection.close(1000, "Stream ended");
    };

    const recover = (reason: string) => {
      if (!isCurrent()) return;

      releaseConnection();

      if (retries >= config.maxRetries) {
        fail(`${reason} Automatic retries exhausted. Start again to retry.`);
        return;
      }

      const delay = Math.min(8000, 250 * 2 ** retries) * (0.5 + Math.random() * 0.5);
      retries += 1;
      onStatus({ phase: "reconnecting", message: `${reason} Reconnecting (${retries}/${config.maxRetries})…` });
      retryTimer = setTimeout(connect, delay);
    };

    const armDeadline = (duration: number, message: string) => {
      clearTimeout(deadline);
      deadline = setTimeout(() => recover(message), duration);
    };

    const scheduleCapture = () => {
      if (!isCurrent()) return;

      cancelCapture?.();
      clearTimeout(deadline);
      deadline = setTimeout(
        () => fail("The camera is not producing new video frames."),
        Math.max(0, lastCaptureAt + config.mediaReadyTimeoutMs - performance.now()),
      );

      cancelCapture = scheduleFrame?.(nextCaptureAt, (mediaTime) => void sendFrame(mediaTime));
      if (!cancelCapture) {
        const timer = setTimeout(() => void sendFrame(), Math.max(0, Math.ceil(nextCaptureAt - performance.now())));
        cancelCapture = () => clearTimeout(timer);
      }
    };

    const sendFrame = async (mediaTime?: number) => {
      if (!isCurrent() || !streamId || pendingFrameId !== null) return;
      cancelCapture = undefined;
      if (connection.readyState !== WebSocket.OPEN || connection.bufferedAmount !== 0) {
        recover("The connection is unavailable or backlogged.");
        return;
      }

      const captureStartedAt = performance.now();
      armDeadline(config.frameTimeoutMs, "Frame capture or response timed out.");

      try {
        const frame = await capture(abort.signal, mediaTime);

        if (!isCurrent()) return;

        if (!frame || frame.capturedAtMs <= lastTimestamp) {
          if (mediaTime === undefined) nextCaptureAt = captureStartedAt + config.frameIntervalMs;
          scheduleCapture();
          return;
        }

        const packet = createFramePacket(frame, streamId, nextFrameId);

        if (connection.readyState !== WebSocket.OPEN || connection.bufferedAmount !== 0) {
          recover("The connection is unavailable or backlogged.");
          return;
        }

        pendingFrameId = nextFrameId++;
        // Preserve the average cadence across discrete video frames, with at most one interval of credit.
        nextCaptureAt = Math.max(nextCaptureAt + config.frameIntervalMs, captureStartedAt);
        frameWidth = frame.width;
        frameHeight = frame.height;
        lastTimestamp = frame.capturedAtMs;
        lastCaptureAt = performance.now();
        connection.send(packet);
      } catch {
        if (isCurrent()) fail("Frame capture or sending failed. Check the camera and service.");
      }
    };

    connection.onopen = () => {
      if (!isCurrent()) return;

      onStatus({ phase: "starting", message: "Waiting for the CV service to start the stream…" });
      armDeadline(config.connectionTimeoutMs, "Stream startup timed out.");

      try {
        connection.send(JSON.stringify({ type: "stream:start", requestId, protocolVersion: 3 }));
      } catch {
        recover("Stream startup failed.");
      }
    };

    connection.onmessage = (event) => {
      if (!isCurrent()) return;

      try {
        const message = parseServerMessage(event.data);

        if (message.type === "stream:started") {
          if (message.requestId !== requestId || streamId) return;

          clearTimeout(deadline);
          streamId = message.streamId;
          lastCaptureAt = nextCaptureAt = performance.now();
          onStatus({ phase: "streaming", message: "Sending camera frames to the CV service." });
          scheduleCapture();
        } else if (message.type === "tracking:result") {
          if (message.streamId !== streamId || message.frameId !== pendingFrameId) {
            if (message.gesture === "select") onSelectReceipt?.({ frameId: message.frameId, status: "unmatched" });
            return;
          }

          clearTimeout(deadline);
          pendingFrameId = null;
          consecutiveRejections = 0;
          retries = 0;

          const remainingMs = lastTimestamp + config.trackingMaxAgeMs - performance.now();
          if (message.gesture === "select") {
            onSelectReceipt?.({ frameId: message.frameId, status: remainingMs <= 0 ? "expired" : "fresh" });
          }
          if (remainingMs <= 0) {
            clearTracking();
          } else {
            clearTimeout(expiry);
            onTracking?.({ gesture: message.gesture, hands: message.hands, width: frameWidth, height: frameHeight });
            expiry = setTimeout(clearTracking, remainingMs);
          }

          scheduleCapture();
        } else if (message.type === "stream:stopped") {
          if (message.streamId === streamId) recover("The service ended the stream.");
        } else if (message.type === "stream:error") {
          if (!streamId && message.requestId !== requestId) return;
          if (streamId && message.streamId !== undefined && message.streamId !== streamId) return;

          if (message.fatal) {
            fail(`CV service: ${message.message}`);
          } else if (streamId && message.streamId === streamId && message.frameId === pendingFrameId) {
            consecutiveRejections++;
            if (consecutiveRejections >= config.maxConsecutiveRejections) {
              fail("The service repeatedly rejected camera frames. Check the camera and service, then start again.");
              return;
            }

            clearTimeout(deadline);
            pendingFrameId = null;
            clearTracking();
            scheduleCapture();
          }
        }
      } catch {
        fail("The CV service does not speak streaming protocol v3. Check the endpoint implementation.");
      }
    };

    connection.onclose = () => recover("The CV service disconnected.");
    connection.onerror = () => recover("Could not reach the CV service.");
    onStatus({ phase: "connecting", message: "Connecting to the CV service…" });
    armDeadline(config.connectionTimeoutMs, "Connection timed out.");
  };

  const connect = () => {
    if (stopped) return;
    if (!checkHealth) {
      openConnection();
      return;
    }

    const abort = new AbortController();
    healthAbort = abort;
    onStatus({ phase: "checking", message: "Checking CV service health…" });
    healthTimer = setTimeout(() => {
      if (!stopped) fail("CV service health check timed out. Check the service and try again.");
    }, config.connectionTimeoutMs);

    void checkHealth(abort.signal).then(() => {
      if (!stopped && !abort.signal.aborted) openConnection();
    }).catch(() => {
      if (!stopped) fail("CV service health check failed. Check the service URL, availability, and HTTP CORS settings.");
    }).finally(() => {
      clearTimeout(healthTimer);
    });
  };

  connect();

  return { stop };
};
