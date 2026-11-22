import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector2, Vector3 } from "three";
import { projectGeometry } from "../src/scene/geometry.ts";
import { createPicker, homeView, moveView, turnView } from "../src/scene/interaction.ts";
import { fieldOfView, galleryLayout, hall, homeDepth, projects } from "../src/scene/projects.ts";
import { createSceneInput } from "../src/scene/handInput.ts";
import type { Gesture } from "../src/utils/gestures.ts";
import type { TrackingSample } from "../src/utils/types.ts";

const observation = (gesture: Gesture, x = 0.25, y = 0.75): TrackingSample => {
  const landmarks: [number, number, number][] = Array.from({ length: 21 }, () => [0.5, 0.5, 0]);
  landmarks[8] = [x, y, -0.6];
  return { gesture, hands: [{ landmarks }], width: 640, height: 480 };
};

test("the index is mirrored once, bounded at the edges, and independent of landmark depth", () => {
  const input = createSceneInput();
  input.observe(observation("cursor"));
  assert.deepEqual(input.cursor, { x: 0.5, y: -0.5 });
  input.observe(observation("cursor", -0.1, 1.2));
  assert.deepEqual(input.cursor, { x: 1, y: -1 });
});

test("a bend selects once at the last extended fingertip, even if the next cursor frame has arrived", () => {
  const input = createSceneInput();
  input.observe(observation("cursor"));
  input.observe(observation("select", 0.85, 0.8));
  input.observe(observation("select", 0.85, 0.8));
  input.observe(observation("cursor", 0.4, 0.1));
  assert.deepEqual(input.consumeSelection(), { x: 0.5, y: -0.5 });
  assert.equal(input.consumeSelection(), null);
  input.observe(observation("select"));
  assert.deepEqual(input.consumeSelection(), { x: 1 - 2 * 0.4, y: 0.8 });
});

test("expiry, empty results and switching to camera mode disarm a bend and discard pending selection", () => {
  for (const loss of [null, { ...observation("idle"), hands: [] }, observation("pan_ready")]) {
    const input = createSceneInput();
    input.observe(observation("cursor"));
    input.observe(observation("select"));
    input.observe(loss);
    assert.equal(input.pointing, false);
    assert.equal(input.consumeSelection(), null);
    input.observe(observation("select"));
    assert.equal(input.consumeSelection(), null);
  }
});

test("pan, turning and dolly use elapsed time, stop on tracking loss, and stay inside the hall", () => {
  for (const gesture of ["pan_left", "pan_right", "pan_up", "pan_down", "rotate_left", "rotate_right", "zoom_in", "zoom_out"] as const) {
    const fast = homeView();
    const slow = homeView();
    for (let i = 0; i < 60; i++) moveView(fast, gesture, 1 / 60, -6);
    for (let i = 0; i < 30; i++) moveView(slow, gesture, 1 / 30, -6);
    for (const key of ["x", "y", "yaw", "z"] as const) assert.ok(Math.abs(fast[key] - slow[key]) < 1e-10);
    assert.notDeepEqual(fast, homeView());
    const stopped = { ...fast, turnSpeed: 0 };
    for (const ready of ["idle", "pan_ready", "rotate_ready", "zoom_ready", "cursor", "select"] as const) moveView(fast, ready, 0.05, -6);
    assert.deepEqual(fast, stopped);
    for (let i = 0; i < 1000; i++) moveView(fast, gesture, 1, -6);
    assert.ok(Math.abs(fast.x) <= hall.halfWidth - hall.clearance && Math.abs(fast.yaw) <= Math.PI);
    assert.ok(Math.abs(fast.z) <= hall.halfDepth - hall.clearance);
    assert.ok(fast.y >= -6 + hall.clearance && fast.y <= -6 + hall.height - hall.clearance);
  }
});

test("hand turning ramps up and brakes in the ready pose at either frame rate", () => {
  for (const gesture of ["rotate_left", "rotate_right"] as const) {
    const angles = [30, 60].map((fps) => {
      const view = homeView();
      const direction = gesture === "rotate_right" ? 1 : -1;
      const step = 1 / fps;
      moveView(view, gesture, step, -6);
      assert.ok(view.turnSpeed * direction > 0 && Math.abs(view.turnSpeed) < 1);
      for (let frame = 1; frame < fps / 2; frame++) moveView(view, gesture, step, -6);
      assert.equal(view.turnSpeed, direction * 1.85);
      const beforeRelease = view.yaw;
      moveView(view, "rotate_ready", step, -6);
      assert.ok(Math.abs(view.turnSpeed) < 1.85 && Math.abs(view.turnSpeed) > 0);
      for (let frame = 1; frame < fps / 2; frame++) moveView(view, "rotate_ready", step, -6);
      assert.equal(view.turnSpeed, 0);
      assert.ok(Math.abs((view.yaw - beforeRelease) * direction - 0.111) < 1e-9);
      const stopped = view.yaw;
      moveView(view, "rotate_ready", step, -6);
      assert.equal(view.yaw, stopped);
      return stopped;
    });
    assert.ok(Math.abs(angles[0] - angles[1]) < 1e-9);
  }
});

test("open-palm panning moves at 9 horizontal and 6.75 vertical units per second", () => {
  const view = homeView();
  for (let frame = 0; frame < 30; frame++) moveView(view, "pan_right", 1 / 30, -6);
  for (let frame = 0; frame < 30; frame++) moveView(view, "pan_up", 1 / 30, -6);
  assert.ok(Math.abs(view.x - 9) < 1e-9);
  assert.ok(Math.abs(view.y - 6.75) < 1e-9);
});

test("a short zoom moves several units, and turning changes heading without orbiting the exhibits", () => {
  const view = homeView();
  for (let i = 0; i < 15; i++) moveView(view, "zoom_in", 1 / 60, -6);
  assert.ok(Math.abs(view.z - (homeDepth - 4.5)) < 1e-9);
  const z = view.z;
  for (let i = 0; i < 60; i++) moveView(view, "rotate_right", 1 / 60, -6);
  assert.ok(Math.abs(view.yaw - 1.85 * (1 - 0.12 / 2)) < 1e-9);
  assert.equal(view.x, 0);
  assert.ok(Math.abs(view.z - z) < 1e-9);
  turnView(view, 4 * Math.PI + Math.PI / 2 - view.yaw);
  moveView(view, "zoom_in", 0.05, -6);
  assert.ok(Math.abs(view.x - 0.9) < 1e-9);
  assert.ok(Math.abs(view.z - z) < 1e-9);
  moveView(view, "pan_right", 0.05, -6);
  assert.ok(Math.abs(view.z - z - 0.45) < 1e-9);
});

test("raycasting uses the real mesh silhouette and nearest surface, including the opening in the ring", () => {
  const material = new MeshBasicMaterial();
  const loop = new Mesh(projectGeometry.phase(), material);
  loop.userData.projectId = "phase";
  const helix = new Mesh(projectGeometry.helix(), material);
  helix.userData.projectId = "helix";
  helix.position.z = -4;
  helix.scale.setScalar(2);
  helix.updateMatrixWorld();
  const camera = new PerspectiveCamera(fieldOfView, 1, 0.1, 100);
  camera.position.z = homeDepth;
  camera.updateMatrixWorld();
  const pick = createPicker();
  assert.equal(pick(new Vector2(0, 0), camera, [loop]), null);
  assert.equal(pick(new Vector2(0, 0), camera, [loop, helix]), "helix");
  const rim = new Vector3(1.18, 0, 0).project(camera);
  assert.equal(pick(new Vector2(rim.x, rim.y), camera, [helix, loop]), "phase");
  loop.geometry.dispose();
  helix.geometry.dispose();
  material.dispose();
});

test("all three exhibits fit the home view with separate screen bounds on wide and narrow displays", () => {
  const material = new MeshBasicMaterial();
  const meshes = projects.map(({ id }) => new Mesh(projectGeometry[id](), material));
  for (const [width, height] of [[1280, 800], [1920, 1080], [320, 740], [768, 850]]) {
    const layout = galleryLayout(width, height);
    const camera = new PerspectiveCamera(fieldOfView, width / height, 0.1, 100);
    camera.position.z = homeDepth;
    camera.updateMatrixWorld();
    assert.ok(layout.helix.z - layout.phase.z >= 12 && layout.phase.z - layout.house.z >= 14);
    const boxes = meshes.map((mesh, i) => {
      const id = projects[i].id;
      const pose = layout[id];
      mesh.position.set(pose.x, pose.y, pose.z);
      mesh.scale.setScalar(pose.scale);
      mesh.rotation.set(id === "phase" ? 0.08 : 0.19, -0.48, 0);
      mesh.updateMatrixWorld();
      const screen = new Box3();
      const point = new Vector3();
      const vertices = mesh.geometry.getAttribute("position");
      for (let j = 0; j < vertices.count; j++) {
        point.fromBufferAttribute(vertices, j).applyMatrix4(mesh.matrixWorld);
        assert.ok(point.y > layout.floor);
        screen.expandByPoint(point.project(camera));
      }
      assert.ok(screen.min.x > -1 && screen.max.x < 1 && screen.min.y > -1 && screen.max.y < 1, id);
      screen.min.z = screen.max.z = 0;
      return screen;
    });
    for (let i = 0; i < boxes.length; i++) {
      for (const other of boxes.slice(i + 1)) assert.equal(boxes[i].intersectsBox(other), false);
    }
  }
  meshes.forEach((mesh) => mesh.geometry.dispose());
  material.dispose();
});
