import handFixtureUrl from "../../tests/fixtures/pointing_up.jpg?url";
import { makeSocket } from "./helpers.ts";
import apiClient from "../src/utils/api.ts";
import { parseServerMessage } from "../src/utils/protocol.ts";
import type { Gesture } from "../src/utils/gestures.ts";

// Development-only fixture, not imported by the production app or build.
const mode = new URLSearchParams(location.search).get("mode") ?? "success";
const tracks: MediaStreamTrack[] = [];
// Fixed upright hand for exercising overlay placement without a model.
const mockLandmarks = [
  [0.5, 0.85], [0.4, 0.72], [0.34, 0.63], [0.28, 0.56], [0.22, 0.50],
  [0.40, 0.54], [0.38, 0.40], [0.37, 0.30], [0.36, 0.20],
  [0.49, 0.51], [0.48, 0.35], [0.48, 0.24], [0.48, 0.13],
  [0.57, 0.53], [0.59, 0.38], [0.60, 0.29], [0.61, 0.19],
  [0.64, 0.58], [0.67, 0.48], [0.69, 0.41], [0.71, 0.34],
].map(([x, y]) => [x, y, 0]);

let showHand = true;
let sceneGesture: Gesture = "cursor";
const secondHand = mockLandmarks.map(([x, y, z]) => [0.42 * x, y, z]);
document.getElementById("toggle-hand")!.onclick = () => { showHand = !showHand; };

const metrics = { cameraRequests: 0, connections: 0, frames: 0, pending: 0, maxPending: 0, validJpegs: 0, results: 0, withHands: 0, failures: 0 };

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
    const fixture = new Image();
    if (mode === "live") {
      fixture.src = handFixtureUrl;
      await fixture.decode();
    }

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
      if (mode === "live" && showHand) {
        context.drawImage(fixture, 260 + 120 * Math.sin(frame / 25), 60, 537, 564);
      }
    }, 33);

    return stream;
  },
});

const nativeSocket = window.WebSocket;
if (mode === "live") {
  window.WebSocket = new Proxy(nativeSocket, {
    construct: (Socket, args) => {
      const socket = Reflect.construct(Socket, args) as WebSocket;
      metrics.connections++;
      socket.addEventListener("message", (event) => {
        try {
          const message = parseServerMessage(event.data);
          if (message.type === "tracking:result") {
            metrics.results++;
            if (message.hands.length) metrics.withHands++;
          }
          if (message.type === "stream:error") metrics.failures++;
        } catch {
          metrics.failures++;
        }
      });
      return socket;
    },
  });
} else {
  apiClient.defaults.adapter = async (request) => ({
    data: { status: mode === "unhealthy" ? "unavailable" : "ok" },
    status: 200,
    statusText: "OK",
    headers: {},
    config: request,
  });

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
                peer.receive({ type: "stream:started", requestId: control.requestId, protocolVersion: 3, streamId });
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
                const pose = mode === "scene" ? sceneGesture : "pan_ready";
                const hands = !showHand ? [] : pose === "zoom_in" ? [{ landmarks: mockLandmarks }, { landmarks: secondHand }] : [{ landmarks: mockLandmarks }];
                if (sceneGesture === "select") sceneGesture = "cursor";
                peer.receive({ type: "tracking:result", gesture: showHand ? pose : "idle", hands, streamId, frameId: header.frameId });
              }, mode === "scene" ? 5 : 80);
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
}

const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
};
document.getElementById("hide")!.onclick = () => setVisibility("hidden");
document.getElementById("show")!.onclick = () => setVisibility("visible");
setInterval(() => {
  document.getElementById("metrics")!.textContent = JSON.stringify({
    ...(mode === "live" ? {
      cameraRequests: metrics.cameraRequests,
      connections: metrics.connections,
      results: metrics.results,
      withHands: metrics.withHands,
      failures: metrics.failures,
    } : metrics),
    stoppedTracks: tracks.filter((track) => track.readyState === "ended").length,
  });
}, 100);

await import("../src/main.tsx");

if (mode === "scene") {
  const { checkScene } = await import("./scene-browser.ts");
  await checkScene(mockLandmarks[8], (visible) => { showHand = visible; }, (gesture) => { sceneGesture = gesture; }, tracks);
}
