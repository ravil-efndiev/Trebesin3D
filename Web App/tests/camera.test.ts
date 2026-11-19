import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrameCapture, createFrameScheduler, getCaptureSize, stopMediaTracks } from "../src/utils/camera.ts";
import { config } from "../src/utils/config.ts";

test("capture sizing preserves landscape/portrait aspect ratios and never upscales", () => {
  assert.deepEqual(getCaptureSize(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(getCaptureSize(1080, 1920), { width: 270, height: 480 });
  assert.deepEqual(getCaptureSize(320, 240), { width: 320, height: 240 });
});

test("stopping camera use stops every media track", () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] };

  stopMediaTracks(stream as unknown as MediaStream);
  stopMediaTracks(null);
  assert.equal(stopped, 2);
});

test("frame scheduling skips early video callbacks and cancels the current request", () => {
  let callback: VideoFrameRequestCallback | undefined;
  let requested = 0;
  const cancelled: number[] = [];
  const received: (number | undefined)[] = [];
  const video = {
    requestVideoFrameCallback: (next: VideoFrameRequestCallback) => {
      callback = next;
      return ++requested;
    },
    cancelVideoFrameCallback: (id: number) => cancelled.push(id),
  };
  const schedule = createFrameScheduler(() => video as unknown as HTMLVideoElement);
  const cancel = schedule(55, (mediaTime) => received.push(mediaTime));
  callback!(33, { mediaTime: 0.033 } as VideoFrameCallbackMetadata);
  assert.deepEqual(received, []);
  assert.equal(requested, 2);
  callback!(67, { mediaTime: 0.067 } as VideoFrameCallbackMetadata);
  assert.deepEqual(received, [0.067]);

  const cancelNext = schedule(120, (mediaTime) => received.push(mediaTime));
  callback!(100, { mediaTime: 0.1 } as VideoFrameCallbackMetadata);
  cancelNext!();
  assert.deepEqual(cancelled, [4]);
  assert.deepEqual(received, [0.067]);
  assert.ok(cancel);
  assert.equal(createFrameScheduler(() => null)(0, () => {}), undefined);
});

test("stalled video callbacks fall back to polling once and ignore a late callback", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => 1000);
  let callback: VideoFrameRequestCallback | undefined;
  const cancelled: number[] = [];
  const received: (number | undefined)[] = [];
  const video = {
    requestVideoFrameCallback: (next: VideoFrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelVideoFrameCallback: (id: number) => cancelled.push(id),
  };
  const schedule = createFrameScheduler(() => video as unknown as HTMLVideoElement);
  schedule(1050, (mediaTime) => received.push(mediaTime));
  t.mock.timers.tick(50);
  assert.deepEqual(received, []);
  t.mock.timers.tick(config.videoFrameCallbackTimeoutMs);
  assert.deepEqual(received, [undefined]);
  assert.deepEqual(cancelled, [1]);
  callback!(1250, { mediaTime: 0.25 } as VideoFrameCallbackMetadata);
  assert.deepEqual(received, [undefined]);
  assert.equal(schedule(1300, () => assert.fail("Polling takes over after the deadline")), undefined);
});

test("repeated video timestamps do not keep an unusable callback path active", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(performance, "now", () => 1000);
  let callback: VideoFrameRequestCallback | undefined;
  const received: (number | undefined)[] = [];
  const video = {
    requestVideoFrameCallback: (next: VideoFrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelVideoFrameCallback: () => {},
  };
  const schedule = createFrameScheduler(() => video as unknown as HTMLVideoElement);
  const receive = (mediaTime?: number) => received.push(mediaTime);
  schedule(1000, receive);
  callback!(1000, { mediaTime: 0 } as VideoFrameCallbackMetadata);
  schedule(1050, receive);
  for (const now of [1067, 1100, 1133]) {
    callback!(now, { mediaTime: 0 } as VideoFrameCallbackMetadata);
  }
  assert.deepEqual(received, [0]);
  t.mock.timers.tick(50 + config.videoFrameCallbackTimeoutMs);
  assert.deepEqual(received, [0, undefined]);
});

test("capture skips unready/duplicate video and safely ignores an encode completed after abort", async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let finishEncode: BlobCallback | undefined;
  let drawings = 0;
  let allocations = 0;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => drawings++ }),
    toBlob: (callback: BlobCallback) => { finishEncode = callback; },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => { allocations++; return canvas; } },
  });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  const video = { readyState: 0, videoWidth: 1920, videoHeight: 1080, currentTime: 1 };
  const capture = createFrameCapture(() => video as HTMLVideoElement);
  assert.equal(await capture(new AbortController().signal), null);

  video.readyState = 2;
  const first = capture(new AbortController().signal);
  finishEncode!(new Blob(["synthetic"], { type: "image/jpeg" }));
  const frame = await first;
  assert.equal(frame?.width, 640);
  assert.equal(frame?.height, 360);
  assert.equal(await capture(new AbortController().signal), null);

  video.currentTime = 2;
  assert.equal(await capture(new AbortController().signal, 1), null);
  const abort = new AbortController();
  const pending = capture(abort.signal, 2);
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  finishEncode!(new Blob(["late"], { type: "image/jpeg" }));
  assert.equal(drawings, 2);
  assert.equal(allocations, 1);
});
