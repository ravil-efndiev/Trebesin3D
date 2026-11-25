import type { TrackingSample } from "../utils/types.ts";
import type { Gesture } from "../utils/gestures.ts";
import { projects, type ProjectId } from "./projects.ts";

// Match the service's bend window across intermediate idle samples.
const cursorMemoryMs = 280;

export const createSceneInput = (reportSelection?: (status: string) => void) => {
  const cursor = { x: 0, y: 0 };
  const selection = { x: 0, y: 0 };
  let pointing = false;
  let pending = false;
  let lastCursorAt: number | null = null;
  let gesture: Gesture = "idle";

  const observe = (sample: TrackingSample | null) => {
    const next = sample?.gesture ?? "idle";
    const tip = sample?.hands[0]?.landmarks[8];
    const now = performance.now();
    if (next === "cursor" && tip) {
      // JPEG landmarks are unmirrored. Map once into the mirrored scene's normalized device coordinates.
      cursor.x = 1 - 2 * Math.min(1, Math.max(0, tip[0]));
      cursor.y = 1 - 2 * Math.min(1, Math.max(0, tip[1]));
      pointing = true;
      lastCursorAt = now;
    } else if (next === "select") {
      if (tip && lastCursorAt !== null && now - lastCursorAt <= cursorMemoryMs) {
        selection.x = cursor.x;
        selection.y = cursor.y;
        pending = true;
        reportSelection?.("Queued for picking");
      }
      if (!pending) reportSelection?.("No recent pointing sample");
      lastCursorAt = null;
    } else {
      pointing = false;
      // A partially bent index can produce idle while the same hand is still tracked.
      if (next !== "idle" || !sample?.hands.length) {
        if (pending) reportSelection?.("Selection cleared before picking");
        pending = false;
        lastCursorAt = null;
      }
    }
    gesture = next;
  };

  return {
    observe,
    reportPick: (id: ProjectId | null) => {
      if (reportSelection) {
        const project = projects.find((item) => item.id === id);
        reportSelection(project ? `Picked ${project.name}` : "Pointer missed the exhibits");
      }
    },
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
