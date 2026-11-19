import type { CapturedFrame, StreamSocket } from "../src/utils/types.ts";

export const makeFrame = (capturedAtMs = 1): CapturedFrame => ({
  jpeg: new Blob([new Uint8Array([255, 216, 255, 217])], { type: "image/jpeg" }),
  width: 640,
  height: 480,
  capturedAtMs,
});

export const makeSocket = () => {
  const sent: (string | Blob)[] = [];
  const socket = {
    readyState: 0,
    bufferedAmount: 0,
    onopen: null as StreamSocket["onopen"],
    onclose: null as StreamSocket["onclose"],
    onmessage: null as StreamSocket["onmessage"],
    onerror: null as StreamSocket["onerror"],
    send: (message: string | Blob) => { sent.push(message); },
    close: () => { socket.readyState = 3; },
  };
  const receive = (message: unknown) => {
    socket.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  };
  const start = (streamId = "test-stream") => {
    socket.readyState = 1;
    socket.onopen?.(new Event("open"));
    const request = JSON.parse(sent.find((message) => typeof message === "string") as string);
    receive({ type: "stream:started", requestId: request.requestId, protocolVersion: 2, streamId });
  };

  return { socket, sent, receive, start, frames: () => sent.filter((message) => message instanceof Blob) };
};
