import assert from "node:assert/strict";
import { test } from "node:test";
import { createFrameCapture, getCaptureSize, stopMediaTracks } from "../src/utils/camera.ts";

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
  const abort = new AbortController();
  const pending = capture(abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  finishEncode!(new Blob(["late"], { type: "image/jpeg" }));
  assert.equal(drawings, 2);
  assert.equal(allocations, 1);
});
