import { config } from "./config.ts";
import type { CapturedFrame, FrameHeader, ServerMessage } from "./types.ts";

const encoder = new TextEncoder();
const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;
const isFrameId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isHand = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("landmarks" in value)) return false;

  const points = value.landmarks;
  return Array.isArray(points) && points.length === 21 && points.every((point) =>
    Array.isArray(point) && point.length === 3 && point.every((n) => Number.isFinite(n) && Math.abs(n) <= 8)
  );
};

export const validateStreamUrl = (value: string, pageProtocol: string): string => {
  const url = new URL(value);

  if (
    !["ws:", "wss:"].includes(url.protocol)
    || url.username || url.password || url.hash
    || (pageProtocol === "https:" && url.protocol !== "wss:")
  ) {
    throw new Error("Use a ws:// URL locally or wss:// on HTTPS, without credentials or fragments.");
  }

  return url.href;
};

export const parseServerMessage = (data: unknown): ServerMessage => {
  if (typeof data !== "string" || data.length > config.maxResponseBytes || encoder.encode(data).byteLength > config.maxResponseBytes) {
    throw new Error("Expected a bounded JSON response from the CV service.");
  }

  const message: unknown = JSON.parse(data);

  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Invalid CV service response.");
  }

  const record = message as Record<string, unknown>;
  let keys: string[] = [];
  let valid = false;

  switch (record.type) {
    case "stream:started":
      keys = ["type", "requestId", "protocolVersion", "streamId"];
      valid = isId(record.requestId) && isId(record.streamId) && record.protocolVersion === 2;
      break;
    case "stream:stopped":
      keys = ["type", "requestId", "streamId"];
      valid = isId(record.requestId) && isId(record.streamId);
      break;
    case "tracking:result":
      keys = ["type", "streamId", "frameId", "hands"];
      valid = isId(record.streamId) && isFrameId(record.frameId)
        && Array.isArray(record.hands) && record.hands.length <= 2 && record.hands.every(isHand);
      break;
    case "stream:error":
      keys = ["type", "code", "message", "fatal", "requestId", "streamId", "frameId"];
      valid = isId(record.code)
        && typeof record.message === "string" && record.message.length > 0 && record.message.length <= 256
        && typeof record.fatal === "boolean"
        && (record.requestId === undefined || isId(record.requestId))
        && (record.streamId === undefined || isId(record.streamId))
        && (record.frameId === undefined || isFrameId(record.frameId));
      break;
  }

  if (!valid || Object.keys(record).some((key) => !keys.includes(key))) {
    throw new Error("CV service response does not match streaming protocol v2.");
  }

  return record as unknown as ServerMessage;
};

export const createFramePacket = (frame: CapturedFrame, streamId: string, frameId: number): Blob => {
  if (
    !isId(streamId) || !isFrameId(frameId)
    || !Number.isFinite(frame.capturedAtMs) || frame.capturedAtMs < 0
    || !Number.isInteger(frame.width) || frame.width < 1 || frame.width > config.maxFrameWidth
    || !Number.isInteger(frame.height) || frame.height < 1 || frame.height > config.maxFrameHeight
    || frame.jpeg.type !== "image/jpeg" || frame.jpeg.size < 1 || frame.jpeg.size > config.maxJpegBytes
  ) {
    throw new Error("Captured frame exceeds the streaming protocol limits.");
  }

  const header: FrameHeader = {
    type: "stream:frame",
    protocolVersion: 2,
    streamId,
    frameId,
    capturedAtMs: frame.capturedAtMs,
    width: frame.width,
    height: frame.height,
    mimeType: "image/jpeg",
  };
  const headerBytes = encoder.encode(JSON.stringify(header));

  if (headerBytes.byteLength > config.maxHeaderBytes) {
    throw new Error("Frame header exceeds the streaming protocol limit.");
  }

  const prefix = new ArrayBuffer(4);
  new DataView(prefix).setUint32(0, headerBytes.byteLength, false);

  return new Blob([prefix, headerBytes, frame.jpeg], { type: "application/octet-stream" });
};
