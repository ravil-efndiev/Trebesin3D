import { Raycaster, Vector2, Vector3 } from "three";
import type { Camera, Intersection, Object3D } from "three";
import type { Gesture } from "../utils/gestures.ts";
import type { ProjectId } from "./projects.ts";
import { hall, homeDepth } from "./projects.ts";

export const homeView = (pivot: { x: number; z: number }) => ({
  pivotX: pivot.x, pivotZ: pivot.z, offsetX: -pivot.x, offsetZ: homeDepth - pivot.z,
  y: 0, yaw: 0, turnSpeed: 0,
});
type View = ReturnType<typeof homeView>;
const maxTurnSpeed = 1.85;
const turnAcceleration = maxTurnSpeed / 0.12;
const maxX = hall.halfWidth - hall.clearance;
const maxZ = hall.halfDepth - hall.clearance;
const minRadius = 2;

// Travel is in world units. Positive heading turns toward +X from the initial -Z view.
export const turnView = (view: View, radians: number) => {
  const next = view.yaw + radians;
  view.yaw = Math.atan2(Math.sin(next), Math.cos(next));
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const { offsetX, offsetZ } = view;
  view.offsetX = offsetX * cos - offsetZ * sin;
  view.offsetZ = offsetX * sin + offsetZ * cos;
};

// Shorten the orbit along its radius near walls while retaining the requested radius.
const wallScale = ({ pivotX, pivotZ, offsetX, offsetZ }: View) => Math.min(
  offsetX === 0 ? Infinity : (Math.sign(offsetX) * maxX - pivotX) / offsetX,
  offsetZ === 0 ? Infinity : (Math.sign(offsetZ) * maxZ - pivotZ) / offsetZ,
);

export const positionCamera = (view: View, camera: Camera) => {
  const scale = Math.min(1, wallScale(view));
  camera.position.set(view.pivotX + scale * view.offsetX, view.y, view.pivotZ + scale * view.offsetZ);
  camera.rotation.set(0, -view.yaw, 0);
  camera.updateMatrixWorld();
};

export const travel = (view: View, forward: number, right: number, up: number, floor: number) => {
  view.pivotX = Math.max(minRadius - maxX, Math.min(maxX - minRadius, view.pivotX + right * Math.cos(view.yaw)));
  view.pivotZ = Math.max(minRadius - maxZ, Math.min(maxZ - minRadius, view.pivotZ + right * Math.sin(view.yaw)));
  if (forward !== 0) {
    const radius = Math.hypot(view.offsetX, view.offsetZ);
    const wallRadius = radius * wallScale(view);
    if (forward > 0 || radius < wallRadius) {
      const nextRadius = Math.max(minRadius, Math.min(wallRadius, Math.min(radius, wallRadius) - forward));
      view.offsetX *= nextRadius / radius;
      view.offsetZ *= nextRadius / radius;
    }
  }
  view.y = Math.max(floor + hall.clearance, Math.min(floor + hall.height - hall.clearance, view.y + up));
};

const easeTurn = (view: { turnSpeed: number }, targetSpeed: number, step: number) => {
  const speed = view.turnSpeed;
  const difference = targetSpeed - speed;
  const timeToTarget = Math.abs(difference) / turnAcceleration;
  const rampTime = Math.min(step, timeToTarget);
  const nextSpeed = timeToTarget <= step ? targetSpeed : speed + Math.sign(difference) * turnAcceleration * rampTime;
  // Integrate the ramp and any time at the target speed within this frame.
  view.turnSpeed = nextSpeed;
  return (speed + nextSpeed) * rampTime / 2 + nextSpeed * (step - rampTime);
};

export const moveView = (view: View, gesture: Gesture, delta: number, floor: number) => {
  const step = Math.min(Math.max(delta, 0), 0.08);
  if (gesture === "rotate_left" || gesture === "rotate_right" || gesture === "rotate_ready") {
    const targetSpeed = gesture === "rotate_right" ? maxTurnSpeed : gesture === "rotate_left" ? -maxTurnSpeed : 0;
    if (targetSpeed !== 0 || view.turnSpeed !== 0) turnView(view, easeTurn(view, targetSpeed, step));
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

const maxElevation = Math.PI / 3;

export const focusView = (target: Vector3, from: Vector3, modelRadius: number) => {
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const dz = from.z - target.z;
  return {
    target: target.clone(),
    angle: Math.hypot(dx, dz) < 0.001 ? 0 : Math.atan2(-dx, dz),
    elevation: Math.max(-0.35, Math.min(0.35, Math.atan2(dy, Math.hypot(dx, dz)))),
    radius: Math.max(3.5, modelRadius * 3.4),
    minRadius: Math.max(2, modelRadius + 0.6),
    turnSpeed: 0,
  };
};

type Focus = ReturnType<typeof focusView>;

export const turnFocus = (focus: Focus, horizontal: number, vertical = 0) => {
  const next = focus.angle + horizontal;
  focus.angle = Math.atan2(Math.sin(next), Math.cos(next));
  focus.elevation = Math.max(-maxElevation, Math.min(maxElevation, focus.elevation + vertical));
};

const wallDistance = (position: number, direction: number, low: number, high: number) =>
  direction === 0 ? Infinity : ((direction > 0 ? high : low) - position) / direction;

export const positionFocusCamera = (focus: Focus, camera: Camera, floor: number) => {
  const { target, angle, elevation } = focus;
  const horizontal = Math.cos(elevation);
  const x = -Math.sin(angle) * horizontal;
  const y = Math.sin(elevation);
  const z = Math.cos(angle) * horizontal;
  const radius = Math.min(focus.radius,
    wallDistance(target.x, x, -maxX, maxX),
    wallDistance(target.y, y, floor + hall.clearance, floor + hall.height - hall.clearance),
    wallDistance(target.z, z, -maxZ, maxZ),
  );
  camera.position.set(target.x + radius * x, target.y + radius * y, target.z + radius * z);
  camera.lookAt(target);
  camera.updateMatrixWorld();
};

export const zoomFocus = (focus: Focus, forward: number) => {
  focus.radius = Math.max(focus.minRadius, Math.min(2 * maxZ, focus.radius - forward));
};

export const moveFocus = (focus: Focus, gesture: Gesture, delta: number) => {
  const step = Math.min(Math.max(delta, 0), 0.08);
  switch (gesture) {
    case "rotate_left": case "pan_left": turnFocus(focus, easeTurn(focus, -maxTurnSpeed, step)); return;
    case "rotate_right": case "pan_right": turnFocus(focus, easeTurn(focus, maxTurnSpeed, step)); return;
    case "rotate_ready": case "pan_ready": turnFocus(focus, easeTurn(focus, 0, step)); return;
    case "pan_up": turnFocus(focus, 0, 1.25 * step); break;
    case "pan_down": turnFocus(focus, 0, -1.25 * step); break;
    case "zoom_in": zoomFocus(focus, 18 * step); break;
    case "zoom_out": zoomFocus(focus, -18 * step); break;
  }
  focus.turnSpeed = 0;
};

export const createPicker = () => {
  const raycaster = new Raycaster();
  const intersections: Intersection<Object3D>[] = [];
  const point = new Vector2();
  return (cursor: { x: number; y: number }, camera: Camera, models: Object3D[]): ProjectId | null => {
    intersections.length = 0;
    raycaster.setFromCamera(point.set(cursor.x, cursor.y), camera);
    raycaster.intersectObjects(models, true, intersections);
    let hit: Object3D | null = intersections[0]?.object ?? null;
    while (hit && !hit.userData.projectId) hit = hit.parent;
    return hit?.userData.projectId ?? null;
  };
};
