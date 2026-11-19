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
  return value === "idle" || handCount === (value.startsWith("zoom_") ? 2 : 1);
};
