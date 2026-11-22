import type { TrackingSample } from "../utils/types.ts";
import type { Gesture } from "../utils/gestures.ts";

export const createSceneInput = () => {
  const cursor = { x: 0, y: 0 };
  const selection = { x: 0, y: 0 };
  let pointing = false;
  let pending = false;
  let gesture: Gesture = "idle";

  const observe = (sample: TrackingSample | null) => {
    const next = sample?.gesture ?? "idle";
    const tip = sample?.hands[0]?.landmarks[8];
    if (next === "cursor" && tip) {
      // JPEG landmarks are unmirrored. Map once into the mirrored scene's normalized device coordinates.
      cursor.x = 1 - 2 * Math.min(1, Math.max(0, tip[0]));
      cursor.y = 1 - 2 * Math.min(1, Math.max(0, tip[1]));
      pointing = true;
    } else if (next === "select" && tip && pointing) {
      if (gesture === "cursor") {
        selection.x = cursor.x;
        selection.y = cursor.y;
        pending = true;
      }
    } else {
      pointing = false;
      pending = false;
    }
    gesture = next;
  };

  return {
    observe,
    cursor,
    get pointing() { return pointing; },
    get gesture() { return gesture; },
    consumeSelection: () => {
      if (!pending) return null;
      pending = false;
      return selection;
    },
  };
};

export type SceneInput = ReturnType<typeof createSceneInput>;
