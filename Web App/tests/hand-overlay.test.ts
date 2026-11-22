import assert from "node:assert/strict";
import { test } from "node:test";
import { drawHandOverlay } from "../src/utils/handOverlay.ts";
import type { TrackingSample } from "../src/utils/types.ts";

const overlay = () => {
  const fills: string[] = [];
  const lines: { color: string; width: number }[] = [];
  const radii: number[] = [];
  const context = {
    fillStyle: "", strokeStyle: "", lineWidth: 0,
    clearRect: () => { fills.length = 0; lines.length = 0; radii.length = 0; },
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: (_x: number, _y: number, radius: number) => { radii.push(radius); },
    stroke: () => { lines.push({ color: context.strokeStyle, width: context.lineWidth }); },
    fill: () => { fills.push(context.fillStyle); },
  };
  const canvas = { width: 640, height: 480, getContext: () => context } as unknown as HTMLCanvasElement;
  const draw = (...positions: number[]) => {
    const sample: TrackingSample = {
      gesture: "idle", width: 640, height: 480,
      hands: positions.map((x) => ({ landmarks: Array.from({ length: 21 }, () => [x, 0.5, 0]) })),
    };
    drawHandOverlay(canvas, sample);
    const bones = lines.filter(({ color }) => fills.includes(color));
    assert.deepEqual(fills, bones.map(({ color }) => color), "joints and bones share each hand's color");
    assert.equal(radii.length, 21 * positions.length);
    assert.ok(radii.every((radius) => bones.every(({ width }) => radius * 2 >= 3 * width)));
    return [...fills];
  };
  return { draw, expire: () => drawHandOverlay(canvas, null) };
};

test("two hands keep distinct overlay colors across reordered observations, exits and re-entry", () => {
  const { draw, expire } = overlay();
  const [blue, purple] = draw(0.8, 0.2);
  assert.deepEqual([blue, purple], ["#2379ff", "#ba36e6"]);
  assert.deepEqual(draw(0.22, 0.78), [purple, blue]);
  assert.deepEqual(draw(0.24), [purple]);
  assert.deepEqual(draw(0.75, 0.23), [blue, purple]);
  expire();
  assert.deepEqual(draw(0.23), [blue]);
  draw();
  assert.deepEqual(draw(0.1, 0.9), [purple, blue]);
});

test("overlay color history belongs to its own camera canvas", () => {
  const a = overlay();
  const b = overlay();
  const [blue, purple] = a.draw(0.8, 0.2);
  assert.deepEqual(a.draw(0.2), [purple]);
  assert.deepEqual(b.draw(0.2), [blue]);
});
