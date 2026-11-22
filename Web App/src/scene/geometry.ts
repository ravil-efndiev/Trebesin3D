import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { hall, type ProjectId } from "./projects.ts";

const finishes = {
  metal: 0xc0d3e3, trim: 0x708ba4, glass: 0x28445b, pane: 0x507995, roof: 0x40516a, violet: 0xa799c6,
  floor: 0x35415b, wall: 0x263248, column: 0x304057, recess: 0x172334, joint: 0x243047, light: 0xa3d0e3,
};
type Finish = keyof typeof finishes;
type Point = [number, number, number];
const sides = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];

// Bake the differently oriented plates and fins into one pickable mesh per exhibit.
const meshBuilder = () => {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();
  const normal = new Vector3();
  const edge = new Vector3();
  const center = new Vector3();
  const corner = new Vector3();

  const solid = (corners: Point[], material: Finish, sideMaterial = material) => {
    center.set(0, 0, 0);
    for (const point of corners) center.add(corner.fromArray(point));
    center.multiplyScalar(1 / corners.length);

    sides.forEach((face, side) => {
      const start = positions.length / 3;
      color.setHex(finishes[side < 2 ? sideMaterial : material]);
      for (const i of face) {
        positions.push(...corners[i]);
        colors.push(color.r, color.g, color.b);
      }
      corner.fromArray(corners[face[0]]);
      normal.fromArray(corners[face[1]]).sub(corner);
      normal.cross(edge.fromArray(corners[face[2]]).sub(corner));
      const outward = normal.dot(corner.sub(center)) > 0;
      const second = start + (outward ? 1 : 3);
      const fourth = start + (outward ? 3 : 1);
      indices.push(start, second, start + 2, start, start + 2, fourth);
    });
  };

  const box = (x: number, y: number, z: number, width: number, height: number, depth: number, material: Finish, angle = 0) => {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const corners = Array.from({ length: 8 }, (_, i): Point => {
      const dx = x + (i & 1 ? 0.5 : -0.5) * width;
      const dz = z + (i & 4 ? 0.5 : -0.5) * depth;
      return [dx * cosine + dz * sine, y + (i & 2 ? 0.5 : -0.5) * height, dz * cosine - dx * sine];
    });
    solid(corners, material);
  };

  const build = () => {
    const geometry = new BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };
  return { box, solid, build };
};

const pavilion = () => {
  const mesh = meshBuilder();
  for (let floor = 0; floor < 10; floor++) {
    const angle = -0.72 + floor * 0.134;
    const level = (floor - 4.5) * 0.24;
    const width = 3.04 - 0.13 * Math.cos(floor * 0.69);
    const depth = 2.03 + 0.12 * Math.sin(floor * 0.5);
    const block = (x: number, y: number, z: number, w: number, h: number, d: number, material: Finish) => mesh.box(x, level + y, z, w, h, d, material, angle);
    block(0, 0, 0, width, 0.105, depth, "metal");
    block(0, -0.059, 0, width - 0.055, 0.018, depth - 0.055, "trim");
    if (floor === 9) {
      block(0, 0.062, 0, width - 0.16, 0.025, depth - 0.19, "roof");
      for (let rib = -8; rib <= 8; rib++) block(rib * 0.15, 0.09, 0, 0.075, 0.05, depth - 0.28, "metal");
      continue;
    }
    const w = width - 0.36;
    const d = depth - 0.39;
    block(0, 0.145, 0, w, 0.17, d, "glass");
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const x = (i / 8 - 0.5) * w;
        block(x, 0.146, side * d / 2, 0.025, 0.172, 0.039, "trim");
        if ((i + floor) % 4 === 1) block(x + 0.13, 0.148, side * (d / 2 + 0.003), 0.24, 0.13, 0.012, "pane");
      }
    }
  }
  return mesh.build();
};

const phaseLoop = () => {
  const mesh = meshBuilder();
  for (let i = 0; i < 96; i++) {
    const t = i * Math.PI * 2 / 96;
    const twist = 0.5 * t + 0.3;
    const corners = Array.from({ length: 8 }, (_, k): Point => {
      const wide = k & 1 ? 0.46 : -0.46;
      const deep = k & 2 ? 0.29 : -0.29;
      const along = k & 4 ? 0.024 : -0.024;
      const radius = 1.18 + Math.cos(twist) * wide - Math.sin(twist) * deep;
      const y = Math.sin(t) * radius + Math.cos(t) * along;
      return [Math.cos(t) * radius - Math.sin(t) * along + 0.17 * y, y, Math.sin(twist) * wide + Math.cos(twist) * deep];
    });
    mesh.solid(corners, "metal", "violet");
  }
  return mesh.build();
};

const offsetHouse = () => {
  const mesh = meshBuilder();
  const block = (x: number, y: number, z: number, w: number, h: number, d: number, material: Finish) => mesh.box(x + 0.15, y - 1.79, z, w, h, d, material);
  block(0.2, 0.75, 0.05, 2.73, 0.21, 2.18, "metal");
  block(0.48, 1.25, 0.02, 1.84, 0.86, 1.51, "glass");
  block(1.23, 1.25, 0.1, 0.22, 1, 2.1, "metal");
  block(-0.5, 1.3, -0.6, 0.23, 1.1, 1.4, "metal");
  block(-0.32, 1.82, 0, 3.58, 0.25, 2.38, "metal");
  block(-1.98, 2.24, 0, 0.23, 0.7, 2.38, "metal");
  block(-0.54, 2.25, -0.93, 2.7, 0.79, 0.22, "metal");
  block(-0.24, 2.25, -0.02, 2.48, 0.63, 1.4, "glass");
  for (let i = 0; i < 19; i++) block(-1.68 + i * 0.092, 2.25, 0.91, 0.037, 0.76, 0.235, "trim");
  block(-0.38, 2.72, -0.02, 3.5, 0.19, 2.42, "metal");
  block(0.63, 2.86, -0.25, 0.91, 0.12, 1.2, "roof");
  for (let step = 0; step < 9; step++) block(1.31 - step * 0.178, 0.75 + step * 0.056, 1, 0.19, 0.075, 0.62, "metal");
  return mesh.build();
};

export const projectGeometry: Record<ProjectId, () => BufferGeometry> = { helix: pavilion, phase: phaseLoop, house: offsetHouse };

export const galleryGeometry = () => {
  const room = meshBuilder();
  const { halfWidth, halfDepth, height } = hall;
  room.box(0, -0.15, 0, halfWidth * 2, 0.3, halfDepth * 2, "floor");
  room.box(0, height + 0.15, 0, halfWidth * 2, 0.3, halfDepth * 2, "wall");
  for (const side of [-1, 1]) {
    room.box(0, height / 2, side * halfDepth, halfWidth * 2, height, 0.4, "wall");
    room.box(side * halfWidth, height / 2, 0, 0.4, height, halfDepth * 2, "recess");
    for (let x = -halfWidth + 3; x < halfWidth; x += 6) {
      room.box(x, height / 2, side * (halfDepth - 0.6), 0.5, height, 1.2, "column");
      room.box(x + 0.6, 5, side * (halfDepth - 0.25), 0.08, 8, 0.15, "light");
    }
    for (let z = -halfDepth + 4; z < halfDepth; z += 8) {
      room.box(side * (halfWidth - 0.45), height / 2, z, 0.9, height, 0.55, "column");
      room.box(side * (halfWidth - 0.27), 7, z + 3.9, 0.16, 10, 6.8, "wall");
    }
    room.box(0, 0.22, side * (halfDepth - 0.85), halfWidth * 2, 0.44, 1.6, "column");
  }
  for (let x = -halfWidth; x <= halfWidth; x += 4) {
    room.box(x, 0.006, 0, 0.025, 0.01, halfDepth * 2, "joint");
    room.box(x, height - 0.32, 0, 0.32, 0.64, halfDepth * 2, "column");
  }
  for (let z = -halfDepth; z <= halfDepth; z += 4) {
    room.box(0, 0.006, z, halfWidth * 2, 0.01, 0.025, "joint");
  }
  // Recessed structural bays at different depths give travel a visible parallax reference.
  for (const z of [-32, -12, 9, 32]) {
    for (const side of [-1, 1]) {
      room.box(side * 24, height / 2, z, 0.8, height, 1.05, "column");
      room.box(side * 23.58, 5.8, z, 0.05, 7.4, 0.12, "light");
    }
    room.box(0, height - 1.1, z, 49, 1.35, 1.05, "column");
  }
  return room.build();
};
