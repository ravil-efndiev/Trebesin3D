import { Raycaster, Vector2 } from "three";
import type { Camera, Intersection, Mesh } from "three";
import type { Gesture } from "../utils/gestures.ts";
import type { ProjectId } from "./projects.ts";
import { hall, homeDepth } from "./projects.ts";

export const homeView = () => ({ x: 0, y: 0, z: homeDepth, yaw: 0, turnSpeed: 0 });
type View = ReturnType<typeof homeView>;
const maxTurnSpeed = 1.85;
const turnAcceleration = maxTurnSpeed / 0.12;

// Travel is in world units. Positive heading turns toward +X from the initial -Z view.
export const turnView = (view: View, radians: number) => {
  const next = view.yaw + radians;
  view.yaw = Math.atan2(Math.sin(next), Math.cos(next));
};

export const travel = (view: View, forward: number, right: number, up: number, floor: number) => {
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  const maxX = hall.halfWidth - hall.clearance;
  const maxZ = hall.halfDepth - hall.clearance;
  view.x = Math.max(-maxX, Math.min(maxX, view.x + forward * sin + right * cos));
  view.z = Math.max(-maxZ, Math.min(maxZ, view.z - forward * cos + right * sin));
  view.y = Math.max(floor + hall.clearance, Math.min(floor + hall.height - hall.clearance, view.y + up));
};

const easeTurn = (view: View, targetSpeed: number, step: number) => {
  const speed = view.turnSpeed;
  const difference = targetSpeed - speed;
  const timeToTarget = Math.abs(difference) / turnAcceleration;
  const rampTime = Math.min(step, timeToTarget);
  const nextSpeed = timeToTarget <= step ? targetSpeed : speed + Math.sign(difference) * turnAcceleration * rampTime;
  // Integrate the ramp and any time at the target speed within this frame.
  turnView(view, (speed + nextSpeed) * rampTime / 2 + nextSpeed * (step - rampTime));
  view.turnSpeed = nextSpeed;
};

export const moveView = (view: View, gesture: Gesture, delta: number, floor: number) => {
  const step = Math.min(Math.max(delta, 0), 0.08);
  if (gesture === "rotate_left" || gesture === "rotate_right" || gesture === "rotate_ready") {
    const targetSpeed = gesture === "rotate_right" ? maxTurnSpeed : gesture === "rotate_left" ? -maxTurnSpeed : 0;
    if (targetSpeed !== 0 || view.turnSpeed !== 0) easeTurn(view, targetSpeed, step);
    return;
  }
  // Loss, expiry and other modes cancel the turn immediately.
  view.turnSpeed = 0;
  switch (gesture) {
    case "pan_left": travel(view, 0, -9 * step, 0, floor); break;
    case "pan_right": travel(view, 0, 9 * step, 0, floor); break;
    case "pan_up": travel(view, 0, 0, 6.75 * step, floor); break;
    case "pan_down": travel(view, 0, 0, -6.75 * step, floor); break;
    case "zoom_in": travel(view, 18 * step, 0, 0, floor); break;
    case "zoom_out": travel(view, -18 * step, 0, 0, floor); break;
  }
};

export const createPicker = () => {
  const raycaster = new Raycaster();
  const intersections: Intersection<Mesh>[] = [];
  const point = new Vector2();
  return (cursor: { x: number; y: number }, camera: Camera, models: Mesh[]): ProjectId | null => {
    intersections.length = 0;
    raycaster.setFromCamera(point.set(cursor.x, cursor.y), camera);
    raycaster.intersectObjects(models, false, intersections);
    return intersections[0]?.object.userData.projectId ?? null;
  };
};
