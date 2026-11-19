import type { TrackingSample } from "./types.ts";

// MediaPipe palm loop and the five joint chains, in landmark index order.
const paths = [[0, 5, 9, 13, 17, 0], [0, 1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];

export const drawHandOverlay = (canvas: HTMLCanvasElement | null, sample: TrackingSample | null): void => {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  if (sample && canvas.width !== sample.width) canvas.width = sample.width;
  if (sample && canvas.height !== sample.height) canvas.height = sample.height;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!sample?.hands.length) return;

  context.lineWidth = 3;
  context.lineJoin = "round";
  context.strokeStyle = "#42ecca";
  context.fillStyle = "#fb5896";

  for (const { landmarks } of sample.hands) {
    context.beginPath();
    for (const path of paths) {
      const first = path[0];
      context.moveTo(landmarks[first][0] * width, landmarks[first][1] * height);
      for (let index = 1; index < path.length; index++) {
        const joint = path[index];
        context.lineTo(landmarks[joint][0] * width, landmarks[joint][1] * height);
      }
    }
    context.stroke();

    context.beginPath();
    for (const [x, y] of landmarks) {
      context.moveTo(x * width + 3.5, y * height);
      context.arc(x * width, y * height, 3.5, 0, Math.PI * 2);
    }
    context.fill();
  }
};
