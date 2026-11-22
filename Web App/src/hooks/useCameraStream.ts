import { useCallback, useEffect, useRef, useState } from "react";
import type Webcam from "react-webcam";
import { checkServiceHealth } from "../utils/api.ts";
import { createFrameCapture, createFrameScheduler, stopMediaTracks } from "../utils/camera.ts";
import { gestureLabels, type Gesture } from "../utils/gestures.ts";
import { drawHandOverlay } from "../utils/handOverlay.ts";
import { validateStreamUrl } from "../utils/protocol.ts";
import { createFrameStream } from "../utils/stream.ts";
import type { StreamOptions, StreamStatus } from "../utils/types.ts";

export const useCameraStream = (url: string, onTracking?: StreamOptions["onTracking"], onSelectReceipt?: StreamOptions["onSelectReceipt"]) => {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const webcamRef = useRef<Webcam>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<ReturnType<typeof createFrameStream> | null>(null);
  const requestedRef = useRef(false);
  const cameraSessionRef = useRef(0);
  const removeMediaListeners = useRef(() => {});
  const [gestureText, setGestureText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraSession, setCameraSession] = useState(0);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [status, setStatus] = useState<StreamStatus>({ phase: "idle", message: "Camera is off." });

  const releaseMedia = useCallback(() => {
    removeMediaListeners.current();
    stopMediaTracks(mediaRef.current);
    mediaRef.current = null;
  }, []);

  const stop = useCallback(() => {
    requestedRef.current = false;
    cameraSessionRef.current += 1;
    clientRef.current?.stop();
    releaseMedia();
    setCameraReady(false);
    setEnabled(false);
    setStatus({ phase: "idle", message: "Camera is off." });
  }, [releaseMedia]);

  const reportStatus = useCallback((next: StreamStatus) => {
    if (next.phase === "error") {
      requestedRef.current = false;
      cameraSessionRef.current += 1;
      clientRef.current?.stop();
      releaseMedia();
      setCameraReady(false);
      setEnabled(false);
    }

    setStatus(next);
  }, [releaseMedia]);

  const onUserMediaError = useCallback(() => {
    if (!requestedRef.current || cameraSession !== cameraSessionRef.current) return;
    // react-webcam can report an older permission request after a newer one succeeds in Strict Mode.
    if (mediaRef.current?.getVideoTracks().some((track) => track.readyState === "live")) return;

    reportStatus({ phase: "error", message: "Camera unavailable or permission denied. You can still use the portfolio without it." });
  }, [cameraSession, reportStatus]);

  const onUserMedia = useCallback((media: MediaStream) => {
    if (!requestedRef.current || cameraSession !== cameraSessionRef.current) {
      stopMediaTracks(media);
      return;
    }

    releaseMedia();
    mediaRef.current = media;
    const onEnded = () => {
      if (mediaRef.current === media) onUserMediaError();
    };
    media.getVideoTracks().forEach((track) => track.addEventListener("ended", onEnded));
    removeMediaListeners.current = () => {
      media.getVideoTracks().forEach((track) => track.removeEventListener("ended", onEnded));
    };
    setCameraReady(true);
  }, [cameraSession, onUserMediaError, releaseMedia]);

  const start = useCallback(() => {
    if (requestedRef.current) return;

    try {
      validateStreamUrl(url, window.location.protocol);
      requestedRef.current = true;
      cameraSessionRef.current += 1;
      setCameraSession(cameraSessionRef.current);
      setStatus({ phase: "camera", message: "Waiting for camera permission and video…" });
      setEnabled(true);
    } catch {
      reportStatus({ phase: "error", message: "Invalid CV service URL. Use ws:// locally and wss:// on HTTPS." });
    }
  }, [url, reportStatus]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const isVisible = document.visibilityState !== "hidden";
      if (!isVisible) clientRef.current?.stop();
      setVisible(isVisible);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!enabled || !cameraReady) return;

    if (!visible) {
      reportStatus({ phase: "paused", message: "Camera transmission is paused while this tab is hidden." });
      return;
    }

    let lastGesture: Gesture | undefined;
    let lastCount = 0;
    const getVideo = () => webcamRef.current?.video ?? null;
    const client = createFrameStream({
      url: validateStreamUrl(url, window.location.protocol),
      capture: createFrameCapture(getVideo),
      scheduleFrame: createFrameScheduler(getVideo),
      onStatus: reportStatus,
      onSelectReceipt,
      onTracking: (sample) => {
        drawHandOverlay(overlayRef.current, sample);
        onTracking?.(sample);
        const count = sample?.hands.length ?? 0;
        if (sample?.gesture === lastGesture && count === lastCount) return;

        lastGesture = sample?.gesture;
        lastCount = count;
        setGestureText(sample ? `${count} ${count === 1 ? "hand" : "hands"} · ${gestureLabels[sample.gesture]}` : "");
      },
      checkHealth: (signal) => checkServiceHealth(url, signal),
    });
    clientRef.current = client;

    return () => {
      client.stop();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [enabled, cameraReady, visible, url, reportStatus, onTracking, onSelectReceipt]);

  useEffect(() => () => {
    requestedRef.current = false;
    cameraSessionRef.current += 1;
    clientRef.current?.stop();
    releaseMedia();
  }, [releaseMedia]);

  return { webcamRef, overlayRef, enabled, status, gestureText, start, stop, onUserMedia, onUserMediaError };
};
