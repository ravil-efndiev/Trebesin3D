import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { hall } from "./projects.ts";

const finishes = {
  floor: 0x35415b, wall: 0x263248, column: 0x304057, recess: 0x172334, joint: 0x243047, light: 0xa3d0e3,
};
type Finish = keyof typeof finishes;
type Point = [number, number, number];
const sides = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];

// Combine the gallery's architectural details into one mesh.
const meshBuilder = () => {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();
  const normal = new Vector3();
  const edge = new Vector3();
  const center = new Vector3();
  const corner = new Vector3();

  const box = (x: number, y: number, z: number, width: number, height: number, depth: number, material: Finish) => {
    center.set(x, y, z);
    color.setHex(finishes[material]);
    const corners = Array.from({ length: 8 }, (_, i): Point => [
      x + (i & 1 ? 0.5 : -0.5) * width,
      y + (i & 2 ? 0.5 : -0.5) * height,
      z + (i & 4 ? 0.5 : -0.5) * depth,
    ]);

    for (const face of sides) {
      const start = positions.length / 3;
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
    }
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
  return { box, build };
};

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
