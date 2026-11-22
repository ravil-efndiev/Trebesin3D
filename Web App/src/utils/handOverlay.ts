import type { HandObservation, TrackingSample } from "./types.ts";

// MediaPipe palm loop and the five joint chains, in landmark index order.
const paths = [[0, 5, 9, 13, 17, 0], [0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

const colors = ["#2379ff", "#ba36e6"] as const;
const jointRadius = 8;
interface Palm { x: number; y: number; }
type Slots = [Palm | null, Palm | null];
const previousPalms = new WeakMap<HTMLCanvasElement, Slots>();

// Keep display colors continuous if MediaPipe reorders its observations. Slots expire
// with the overlay and do not imply anatomical handedness or change gesture recognition.
const assignColors = (canvas: HTMLCanvasElement, hands: HandObservation[]) => {
  const palms = hands.map(({ landmarks }) => {
    let x = 0;
    let y = 0;
    for (const joint of [0, 5, 9, 13, 17]) {
      x += landmarks[joint][0] * canvas.width / 5;
      y += landmarks[joint][1] * canvas.height / 5;
    }
    return { x, y };
  });
  const previous = previousPalms.get(canvas);
  const distance = (palm: Palm, slot: Palm | null) => slot ? (palm.x - slot.x) ** 2 + (palm.y - slot.y) ** 2 : 0;
  let first = 0;
  if (!previous) {
    if (palms[1] && palms[1].x > palms[0].x) first = 1;
  } else if (palms.length === 2) {
    const same = distance(palms[0], previous[0]) + distance(palms[1], previous[1]);
    const swapped = distance(palms[0], previous[1]) + distance(palms[1], previous[0]);
    first = swapped < same ? 1 : 0;
  } else if (!previous[0] || (previous[1] && distance(palms[0], previous[1]) < distance(palms[0], previous[0]))) {
    first = 1;
  }

  const next: Slots = [null, null];
  next[first] = palms[0];
  next[1 - first] = palms[1] ?? null;
  previousPalms.set(canvas, next);
  return first;
};

export const drawHandOverlay = (canvas: HTMLCanvasElement | null, sample: TrackingSample | null): void => {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  if (sample && canvas.width !== sample.width) canvas.width = sample.width;
  if (sample && canvas.height !== sample.height) canvas.height = sample.height;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!sample?.hands.length) {
    previousPalms.delete(canvas);
    return;
  }

  context.lineJoin = "round";
  const firstSlot = assignColors(canvas, sample.hands);

  for (const [index, { landmarks }] of sample.hands.entries()) {
    const color = colors[index === 0 ? firstSlot : 1 - firstSlot];
    context.beginPath();
    for (const path of paths) {
      const first = path[0];
      context.moveTo(landmarks[first][0] * width, landmarks[first][1] * height);
      for (let index = 1; index < path.length; index++) {
        const joint = path[index];
        context.lineTo(landmarks[joint][0] * width, landmarks[joint][1] * height);
      }
    }
    context.lineWidth = 7;
    context.strokeStyle = "#c4d7ee";
    context.stroke();
    context.lineWidth = 5;
    context.strokeStyle = color;
    context.stroke();

    context.beginPath();
    for (const [x, y] of landmarks) {
      context.moveTo(x * width + jointRadius, y * height);
      context.arc(x * width, y * height, jointRadius, 0, Math.PI * 2);
    }
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = "#c4d7ee";
    context.stroke();
  }
};
