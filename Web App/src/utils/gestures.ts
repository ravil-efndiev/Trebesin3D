export const gestureLabels = {
  idle: "Idle",
  cursor: "Cursor",
  select: "Cursor · Select",
  pan_ready: "Camera · Move ready",
  pan_left: "Camera · Moving left",
  pan_right: "Camera · Moving right",
  pan_up: "Camera · Moving up",
  pan_down: "Camera · Moving down",
  rotate_ready: "Camera · Rotation ready",
  rotate_left: "Camera · Rotating left",
  rotate_right: "Camera · Rotating right",
  zoom_ready: "Camera · Zoom ready",
  zoom_in: "Camera · Zooming in",
  zoom_out: "Camera · Zooming out",
} as const;

export type Gesture = keyof typeof gestureLabels;

export const isGesture = (value: unknown, handCount: number): value is Gesture => {
  if (typeof value !== "string" || !Object.hasOwn(gestureLabels, value)) return false;
  if (value === "idle") return true;
  if (value.startsWith("zoom_")) return handCount === 2;
  if (value.startsWith("pan_")) return handCount === 1;
  return handCount === 1 || handCount === 2;
};
