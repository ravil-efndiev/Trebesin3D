import { makeSocket } from "./helpers.ts";
import apiClient from "../src/utils/api.ts";

// Development-only fixture, not imported by the production app or build.
const mode = new URLSearchParams(location.search).get("mode") ?? "success";
const tracks: MediaStreamTrack[] = [];
const metrics = { cameraRequests: 0, connections: 0, frames: 0, pending: 0, maxPending: 0, validJpegs: 0, failures: 0 };

apiClient.defaults.adapter = async (request) => ({
  data: { status: mode === "unhealthy" ? "unavailable" : "ok" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: request,
});

Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
  configurable: true,
  value: async () => {
    metrics.cameraRequests++;
    if (mode === "denied") throw new DOMException("Synthetic denial", "NotAllowedError");
    if (mode === "late" && metrics.cameraRequests === 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      throw new DOMException("Synthetic late denial", "NotAllowedError");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(30);
    tracks.push(...stream.getTracks());
    let frame = 0;
    const draw = setInterval(() => {
      if (stream.getTracks().every((track) => track.readyState === "ended")) {
        clearInterval(draw);
        return;
      }

      context.fillStyle = `hsl(${frame++ % 360} 70% 40%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }, 33);

    return stream;
  },
});

const nativeSocket = window.WebSocket;
window.WebSocket = new Proxy(nativeSocket, {
  construct: () => {
    metrics.connections++;
    const peer = makeSocket();
    const record = peer.socket.send;
    const streamId = crypto.randomUUID();
    let pending = 0;
    peer.socket.send = (data) => {
      record(data);
      if (peer.sent.length > 8) peer.sent.shift();

      if (typeof data === "string") {
        const control = JSON.parse(data);
        if (control.type === "stream:start") {
          setTimeout(() => {
            if (mode === "incompatible") {
              peer.socket.onmessage?.({ data: "Message text was: start" } as MessageEvent);
            } else {
              peer.receive({ type: "stream:started", requestId: control.requestId, protocolVersion: 1, streamId });
            }
          }, 10);
        }
        return;
      }

      pending++;
      metrics.pending++;
      metrics.maxPending = Math.max(metrics.maxPending, pending);
      metrics.frames++;
      void (async () => {
        try {
          const bytes = await data.arrayBuffer();
          const length = new DataView(bytes).getUint32(0, false);
          const header = JSON.parse(new TextDecoder().decode(bytes.slice(4, 4 + length)));
          const jpeg = new Blob([bytes.slice(4 + length)], { type: "image/jpeg" });
          const image = await createImageBitmap(jpeg);
          if (header.width !== 640 || header.height !== 360 || image.width !== 640 || image.height !== 360) {
            throw new Error("Unexpected frame dimensions");
          }
          image.close();
          metrics.validJpegs++;

          if (mode !== "slow") {
            setTimeout(() => {
              if (peer.socket.readyState !== 1) return;

              pending--;
              metrics.pending--;
              peer.receive({ type: "frame:ack", streamId, frameId: header.frameId });
            }, 250);
          }
        } catch {
          metrics.failures++;
        }
      })();
    };

    const close = peer.socket.close;
    peer.socket.close = () => {
      metrics.pending -= pending;
      pending = 0;
      close();
    };
    setTimeout(() => {
      if (peer.socket.readyState !== 0) return;
      if (mode === "offline") peer.socket.onerror?.(new Event("error"));
      else {
        peer.socket.readyState = 1;
        peer.socket.onopen?.(new Event("open"));
      }
    }, 10);

    return peer.socket;
  },
});

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
};
document.getElementById("hide")!.onclick = () => setVisibility("hidden");
document.getElementById("show")!.onclick = () => setVisibility("visible");
setInterval(() => {
  document.getElementById("metrics")!.textContent = JSON.stringify({
    ...metrics,
    stoppedTracks: tracks.filter((track) => track.readyState === "ended").length,
  });
}, 100);

await import("../src/main.tsx");
