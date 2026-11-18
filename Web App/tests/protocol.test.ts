import assert from "node:assert/strict";
import { test } from "node:test";
import { createFramePacket, parseServerMessage, validateStreamUrl } from "../src/utils/protocol.ts";
import { config } from "../src/utils/config.ts";
import { makeFrame } from "./helpers.ts";

test("binary frame uses a big-endian UTF-8 byte length and unchanged JPEG bytes", async () => {
  const frame = makeFrame(123.5);
  const packet = await createFramePacket(frame, "stream-č", 17).arrayBuffer();
  const headerLength = new DataView(packet).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(packet.slice(4, 4 + headerLength)));

  assert.deepEqual(header, {
    type: "stream:frame", protocolVersion: 1, streamId: "stream-č", frameId: 17,
    capturedAtMs: 123.5, width: 640, height: 480, mimeType: "image/jpeg",
  });
  assert.deepEqual(packet.slice(4 + headerLength), await frame.jpeg.arrayBuffer());
});

test("invalid dimensions, bytes, codec, IDs, and timestamps are rejected before sending", () => {
  const frame = makeFrame();

  for (const invalid of [
    { ...frame, width: 641 },
    { ...frame, height: 0 },
    { ...frame, width: 1.5 },
    { ...frame, capturedAtMs: NaN },
    { ...frame, capturedAtMs: -1 },
    { ...frame, jpeg: new Blob([], { type: "image/jpeg" }) },
    { ...frame, jpeg: new Blob(["png"], { type: "image/png" }) },
    { ...frame, jpeg: new Blob([new Uint8Array(config.maxJpegBytes + 1)], { type: "image/jpeg" }) },
  ]) {
    assert.throws(() => createFramePacket(invalid, "stream", 1));
  }

  assert.throws(() => createFramePacket(frame, "", 1));
  assert.throws(() => createFramePacket(frame, "stream", 0));
});

test("server messages reject unknown types, extra fields, malformed IDs, binary, and oversized JSON", () => {
  for (const message of [
    "not JSON", "[]", "null", JSON.stringify({ type: "unknown" }),
    JSON.stringify({ type: "frame:ack", streamId: "s", frameId: -1 }),
    JSON.stringify({ type: "frame:ack", streamId: "s", frameId: 1, extra: true }),
    JSON.stringify({ type: "stream:started", requestId: "r", streamId: "s", protocolVersion: 2 }),
    JSON.stringify({ type: "stream:error", code: "X", message: "x", fatal: "true" }),
    " ".repeat(config.maxResponseBytes + 1),
    JSON.stringify("č".repeat(config.maxResponseBytes / 2)),
    new Blob(),
  ]) {
    assert.throws(() => parseServerMessage(message));
  }

  const ack = { type: "frame:ack", streamId: "s", frameId: 1 };
  assert.deepEqual(parseServerMessage(JSON.stringify(ack)), ack);
});

test("service URLs reject mixed content, embedded credentials, fragments, and non-WebSocket schemes", () => {
  assert.equal(validateStreamUrl("ws://localhost:9000/api/v1/stream", "http:"), "ws://localhost:9000/api/v1/stream");
  assert.equal(validateStreamUrl("wss://cv.example/api/v1/stream", "https:"), "wss://cv.example/api/v1/stream");

  for (const url of ["ws://localhost:8000", "https://cv.example", "wss://user:secret@cv.example", "wss://cv.example/#x"]) {
    assert.throws(() => validateStreamUrl(url, "https:"));
  }
});
