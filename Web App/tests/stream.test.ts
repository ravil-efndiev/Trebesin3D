import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/utils/config.ts";
import { createFrameStream } from "../src/utils/stream.ts";
import type { CapturedFrame, StreamStatus } from "../src/utils/types.ts";
import { makeFrame, makeSocket } from "./helpers.ts";

test("start is required, cadence is capped, and only a matching result releases the frame slot", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const peer = makeSocket();
  let captures = 0;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket, onStatus: () => {},
    capture: async () => makeFrame(++captures),
  });
  t.after(client.stop);
  t.mock.timers.tick(100);
  assert.equal(captures, 0);
  peer.start();
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(peer.frames().length, 1);

  t.mock.timers.tick(500);
  await Promise.resolve();
  assert.equal(captures, 1);
  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "old-stream", frameId: 1 });
  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "test-stream", frameId: 2 });
  t.mock.timers.tick(100);
  assert.equal(captures, 1);

  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "test-stream", frameId: 1 });
  assert.equal(captures, 1);
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(peer.frames().length, 2);
});

test("stop cancels timers and prevents a late encode from sending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const peer = makeSocket();
  let finishCapture: ((frame: CapturedFrame) => void) | undefined;
  let signal: AbortSignal | undefined;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket, onStatus: () => {},
    capture: (captureSignal) => {
      signal = captureSignal;
      return new Promise((resolve) => { finishCapture = resolve; });
    },
  });
  peer.start();
  t.mock.timers.tick(100);
  client.stop();
  client.stop();
  finishCapture!(makeFrame());
  await Promise.resolve();
  t.mock.timers.tick(10000);

  assert.equal(signal?.aborted, true);
  assert.equal(peer.frames().length, 0);
  assert.equal(peer.socket.readyState, 3);
  assert.equal(peer.sent.filter((data) => typeof data === "string" && JSON.parse(data).type === "stream:stop").length, 1);
});

test("video frame scheduling keeps the pacing clock and waits for each matching result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const peer = makeSocket();
  const slots: number[] = [];
  const mediaTimes: (number | undefined)[] = [];
  let frameReady: ((mediaTime: number) => void) | undefined;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket, onStatus: () => {},
    scheduleFrame: (notBefore, onFrame) => {
      slots.push(notBefore);
      frameReady = onFrame;
      return () => { frameReady = undefined; };
    },
    capture: async (_signal, mediaTime) => {
      mediaTimes.push(mediaTime);
      return makeFrame(now);
    },
  });
  t.after(client.stop);
  peer.start();
  assert.deepEqual(slots, [1000]);

  // The video only has a new frame at discrete points on the pacing clock.
  now = 1033;
  frameReady!(0.033);
  await Promise.resolve();
  assert.equal(peer.frames().length, 1);
  assert.equal(slots.length, 1);
  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "test-stream", frameId: 1 });
  assert.equal(slots[1], 1000 + config.frameIntervalMs);

  now = 1067;
  frameReady!(0.067);
  await Promise.resolve();
  assert.equal(peer.frames().length, 2);
  assert.deepEqual(mediaTimes, [0.033, 0.067]);
  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "test-stream", frameId: 2 });

  now = 1500;
  frameReady!(0.5);
  await Promise.resolve();
  peer.receive({ type: "tracking:result", gesture: "idle", hands: [], streamId: "test-stream", frameId: 3 });
  assert.equal(slots.at(-1), now);

  const lateFrame = frameReady!;
  client.stop();
  assert.equal(frameReady, undefined);
  lateFrame(0.533);
  assert.deepEqual(mediaTimes, [0.033, 0.067, 0.5]);
});

test("a video frame callback that never arrives times out and is cancelled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => 1000);
  const peer = makeSocket();
  const states: StreamStatus[] = [];
  let cancelled = false;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket,
    onStatus: (state) => states.push(state),
    scheduleFrame: () => () => { cancelled = true; },
    capture: async () => assert.fail("Capture requires a video frame"),
  });
  t.after(client.stop);
  peer.start();
  t.mock.timers.tick(config.frameTimeoutMs);
  assert.equal(states.at(-1)?.phase, "streaming");
  t.mock.timers.tick(config.mediaReadyTimeoutMs - config.frameTimeoutMs);
  assert.match(states.at(-1)?.message ?? "", /not producing new video frames/);
  assert.equal(cancelled, true);
});

test("response timeout reconnects with fresh stream state and ignores previous socket callbacks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const peers: ReturnType<typeof makeSocket>[] = [];
  let captures = 0;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", onStatus: () => {}, capture: async () => makeFrame(++captures),
    createSocket: () => { const peer = makeSocket(); peers.push(peer); return peer.socket; },
  });
  t.after(client.stop);
  const previousCallback = peers[0].socket.onmessage!;
  peers[0].start("old");
  t.mock.timers.tick(100);
  await Promise.resolve();
  t.mock.timers.tick(config.frameTimeoutMs);
  assert.equal(peers[0].socket.readyState, 3);
  t.mock.timers.tick(300);
  assert.equal(peers.length, 2);
  peers[1].start("new");
  t.mock.timers.tick(100);
  await Promise.resolve();
  previousCallback({ data: JSON.stringify({ type: "tracking:result", gesture: "idle", hands: [], streamId: "old", frameId: 1 }) } as MessageEvent);
  t.mock.timers.tick(100);
  assert.equal(peers[1].frames().length, 1);

  const packet = await peers[1].frames()[0].arrayBuffer();
  const length = new DataView(packet).getUint32(0, false);
  const header = JSON.parse(new TextDecoder().decode(packet.slice(4, 4 + length)));
  assert.equal(header.streamId, "new");
  assert.equal(header.frameId, 1);
});

test("unavailable services have bounded retries, including connections that never open", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let connections = 0;
  const states: StreamStatus[] = [];
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", capture: async () => makeFrame(), onStatus: (state) => states.push(state),
    createSocket: () => { connections++; return makeSocket().socket; },
  });
  t.after(client.stop);

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    t.mock.timers.tick(config.connectionTimeoutMs);
    t.mock.timers.tick(8000);
  }

  assert.equal(connections, config.maxRetries + 1);
  assert.equal(states.at(-1)?.phase, "error");
  t.mock.timers.tick(60000);
  assert.equal(connections, config.maxRetries + 1);
});

test("protocol mismatch ends the stream instead of sending camera images to a text echo", (t) => {
  const peer = makeSocket();
  const states: StreamStatus[] = [];
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", capture: async () => makeFrame(),
    createSocket: () => peer.socket, onStatus: (state) => states.push(state),
  });
  t.after(client.stop);
  peer.socket.onmessage?.({ data: "Message text was: hello" } as MessageEvent);

  assert.equal(states.at(-1)?.phase, "error");
  assert.equal(peer.socket.readyState, 3);
  assert.equal(peer.frames().length, 0);
});

test("backpressure resets the connection without capturing or adding to the outgoing buffer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const peer = makeSocket();
  let captures = 0;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket, onStatus: () => {},
    capture: async () => { captures++; return makeFrame(); },
  });
  t.after(client.stop);
  peer.start();
  peer.socket.bufferedAmount = 10;
  t.mock.timers.tick(100);

  assert.equal(captures, 0);
  assert.equal(peer.socket.readyState, 3);
});

test("a matching nonfatal rejection releases the slot but a fatal error ends the stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const peer = makeSocket();
  let captures = 0;
  const states: StreamStatus[] = [];
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket,
    capture: async () => makeFrame(++captures), onStatus: (state) => states.push(state),
  });
  t.after(client.stop);
  peer.start();
  t.mock.timers.tick(100);
  await Promise.resolve();
  peer.receive({ type: "stream:error", code: "INVALID_FRAME", message: "Rejected.", fatal: false, streamId: "test-stream", frameId: 1 });
  t.mock.timers.tick(100);
  await Promise.resolve();
  assert.equal(peer.frames().length, 2);

  peer.receive({ type: "stream:error", code: "EXPIRED", message: "Session ended.", fatal: true, streamId: "test-stream" });
  t.mock.timers.tick(10000);
  assert.equal(peer.frames().length, 2);
  assert.equal(states.at(-1)?.phase, "error");
});

test("health must succeed before opening a socket, and stop prevents a late health response from connecting", async () => {
  let healthy: (() => void) | undefined;
  let sockets = 0;
  let signal: AbortSignal | undefined;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", capture: async () => makeFrame(), onStatus: () => {},
    createSocket: () => { sockets++; return makeSocket().socket; },
    checkHealth: (requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => { healthy = resolve; });
    },
  });
  assert.equal(sockets, 0);
  client.stop();
  healthy!();
  await Promise.resolve();
  assert.equal(signal?.aborted, true);
  assert.equal(sockets, 0);
});

test("failed health never opens a socket; successful health allows connection", async (t) => {
  let sockets = 0;
  const states: StreamStatus[] = [];
  const options = {
    url: "ws://localhost/api/v1/stream", capture: async () => makeFrame(),
    onStatus: (state: StreamStatus) => states.push(state),
    createSocket: () => { sockets++; return makeSocket().socket; },
  };
  const failed = createFrameStream({ ...options, checkHealth: async () => { throw new Error("unavailable"); } });
  t.after(failed.stop);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sockets, 0);
  assert.equal(states.at(-1)?.phase, "error");

  const healthy = createFrameStream({ ...options, checkHealth: async () => {} });
  t.after(healthy.stop);
  assert.equal(sockets, 0);
  await Promise.resolve();
  assert.equal(sockets, 1);
});

test("three consecutive correlated rejections stop capture and success resets the count", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const peer = makeSocket();
  const states: StreamStatus[] = [];
  let captures = 0;
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket,
    capture: async () => makeFrame(++captures), onStatus: (state) => states.push(state),
  });
  t.after(client.stop);
  peer.start();
  const start = JSON.parse(String(peer.sent[0]));
  const rejectFrame = (frameId: number) => peer.receive({
    type: "stream:error", code: "INVALID_FRAME", message: "Rejected.", fatal: false, streamId: "test-stream", frameId,
  });

  for (let frameId = 1; frameId <= 6; frameId++) {
    now += 100;
    t.mock.timers.tick(100);
    await Promise.resolve();
    assert.equal(captures, frameId);
    rejectFrame(frameId + 100);
    if (frameId === 3) {
      const receipt = start.protocolVersion === 1 ? { type: "frame:ack" } : { type: "tracking:result", gesture: "idle", hands: [] };
      peer.receive({ ...receipt, streamId: "test-stream", frameId });
    } else {
      rejectFrame(frameId);
    }
  }
  assert.equal(states.at(-1)?.phase, "error");
  assert.equal(peer.socket.readyState, 3);
  t.mock.timers.tick(10000);
  assert.equal(captures, 6);
});

test("a stalled health check times out and ignores late success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let healthy: (() => void) | undefined;
  let sockets = 0;
  const states: StreamStatus[] = [];
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", capture: async () => makeFrame(), onStatus: (state) => states.push(state),
    createSocket: () => { sockets++; return makeSocket().socket; },
    checkHealth: () => new Promise((resolve) => { healthy = resolve; }),
  });
  t.after(client.stop);
  t.mock.timers.tick(config.connectionTimeoutMs);
  assert.equal(states.at(-1)?.phase, "error");
  healthy!();
  await Promise.resolve();
  assert.equal(sockets, 0);
});

test("tracking displays only a fresh matching sample and clears it at capture age or on stream loss", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const peer = makeSocket();
  const samples: unknown[] = [];
  const hands = [{ landmarks: Array.from({ length: 21 }, () => [0.5, 0.5, 0]) }];
  const client = createFrameStream({
    url: "ws://localhost/api/v1/stream", createSocket: () => peer.socket, onStatus: () => {},
    capture: async () => makeFrame(now), onTracking: (sample) => samples.push(sample),
  });
  t.after(client.stop);
  peer.start();
  t.mock.timers.tick(100);
  await Promise.resolve();
  const receive = (frameId: number, streamId = "test-stream") => {
    peer.receive({ type: "tracking:result", gesture: "cursor", hands, streamId, frameId });
  };

  now += 50;
  receive(1, "other");
  assert.deepEqual(samples, []);
  receive(1);
  assert.deepEqual(samples.at(-1), { gesture: "cursor", hands, width: 640, height: 480 });
  t.mock.timers.tick(149);
  assert.notEqual(samples.at(-1), null);
  t.mock.timers.tick(1);
  assert.equal(samples.at(-1), null);

  await Promise.resolve();
  now += 201;
  receive(2);
  assert.deepEqual(samples.slice(1), [null, null]);
  t.mock.timers.tick(100);
  await Promise.resolve();
  receive(3);
  assert.notEqual(samples.at(-1), null);
  client.stop();
  assert.equal(samples.at(-1), null);
});
