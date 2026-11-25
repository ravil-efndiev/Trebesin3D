import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DataTexture, Group, LinearFilter, Quaternion, RGBAFormat, Vector2, Vector3 } from "three";
import { galleryGeometry, projectGeometry } from "../scene/geometry.ts";
import { createPicker, focusView, homeView, moveFocus, moveView, positionCamera, positionFocusCamera, travel } from "../scene/interaction.ts";
import type { SceneInput } from "../scene/handInput.ts";
import { galleryLayout, projects, type ProjectId } from "../scene/projects.ts";
import ProjectModel from "./ProjectModel.tsx";
import useGalleryControls, { type GalleryDrag, type GalleryFocus } from "./useGalleryControls.ts";

interface Props {
  input: SceneInput;
  active: ProjectId | null;
  selected: ProjectId | null;
  rotations: RefObject<Record<ProjectId, number>>;
  cursor: RefObject<HTMLSpanElement | null>;
  onHover: (id: ProjectId | null) => void;
  onSelect: (id: ProjectId | null) => void;
  onUnavailable: () => void;
}

const focusTransitionSeconds = 0.55;

const shadowTexture = () => {
  const size = 64;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot(2 * (x + 0.5) / size - 1, 2 * (y + 0.5) / size - 1);
      rgba[(y * size + x) * 4 + 3] = Math.round(145 * Math.pow(Math.max(0, 1 - radius * radius), 3));
    }
  }
  const texture = new DataTexture(rgba, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

const GalleryWorld = ({ input, active, selected, rotations, cursor, onHover, onSelect, onUnavailable }: Props) => {
  const { camera, gl, size } = useThree();
  const exhibits = useRef<Group>(null);
  const targets = useRef<Group[]>([]);
  const lastHover = useRef<ProjectId | null>(null);
  const pick = useMemo(createPicker, []);
  const pointer = useMemo(() => new Vector2(), []);
  const pointerInside = useRef(false);
  const drag = useRef<GalleryDrag | null>(null);
  const time = useRef(0);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)"), []);
  const layout = useMemo(() => galleryLayout(size.width, size.height), [size.width, size.height]);
  const [view] = useState(() => homeView(layout.pivot));
  const focus = useRef<GalleryFocus | null>(null);
  const transition = useMemo(() => ({ elapsed: Infinity, from: new Vector3(), rotation: new Quaternion(), goal: camera.clone() }), [camera]);
  const initialPivot = useRef(layout.pivot);
  const assets = useMemo(() => ({
    helix: projectGeometry.helix(), phase: projectGeometry.phase(),
    room: galleryGeometry(), shadow: shadowTexture(),
  }), []);

  useEffect(() => () => { Object.values(assets).forEach((asset) => asset.dispose()); }, [assets]);
  useLayoutEffect(() => {
    targets.current = exhibits.current!.children.filter((child): child is Group => child instanceof Group);
  }, []);
  useLayoutEffect(() => {
    if (focus.current || transition.elapsed < focusTransitionSeconds) return;
    // Follow the exhibit layout, preserving the original framing when still at the entrance.
    const previousHome = homeView(initialPivot.current);
    const atEntrance = view.pivotX === previousHome.pivotX && view.pivotZ === previousHome.pivotZ
      && view.offsetX === previousHome.offsetX && view.offsetZ === previousHome.offsetZ && view.y === 0;
    const dx = layout.pivot.x - initialPivot.current.x;
    const dz = layout.pivot.z - initialPivot.current.z;
    view.pivotX += dx;
    view.pivotZ += dz;
    if (atEntrance) {
      view.offsetX = -layout.pivot.x;
      view.offsetZ = previousHome.offsetZ - dz;
    }
    initialPivot.current = layout.pivot;
    travel(view, 0, 0, 0, layout.floor);
    positionCamera(view, camera);
  }, [camera, view, layout.floor, layout.pivot, transition]);

  useGalleryControls({
    canvas: gl.domElement,
    camera,
    view,
    floor: layout.floor,
    pivot: layout.pivot,
    viewportHeight: size.height,
    transition,
    focusTransitionSeconds,
    initialPivot,
    targets,
    pointer,
    pointerInside,
    drag,
    focus,
    rotations,
    pick,
    onSelect,
    onUnavailable,
  });

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    time.current += step;
    if (selected !== (focus.current?.id ?? null)) {
      transition.from.copy(camera.position);
      transition.rotation.copy(camera.quaternion);
      transition.elapsed = 0;
      view.turnSpeed = 0;
      if (selected) {
        const model = targets.current.find((mesh) => mesh.userData.projectId === selected)!;
        const { x, y, z, scale } = layout[selected];
        focus.current = { id: selected, view: focusView(new Vector3(x, y, z), camera.position, model.userData.focusRadius * scale) };
      } else {
        focus.current = null;
      }
    }

    const focused = focus.current;
    const moving = transition.elapsed < focusTransitionSeconds;
    const destination = moving ? transition.goal : camera;
    if (focused) {
      const { x, y, z } = layout[focused.id];
      focused.view.target.set(x, y, z);
      if (!moving) moveFocus(focused.view, input.gesture, delta);
      positionFocusCamera(focused.view, destination, layout.floor);
    } else {
      if (!moving) moveView(view, input.gesture, delta, layout.floor);
      positionCamera(view, destination);
    }
    if (moving) {
      transition.elapsed = reducedMotion.matches ? focusTransitionSeconds : Math.min(focusTransitionSeconds, transition.elapsed + step);
      const progress = transition.elapsed / focusTransitionSeconds;
      const blend = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(transition.from, destination.position, blend);
      camera.quaternion.slerpQuaternions(transition.rotation, destination.quaternion, blend);
      camera.updateMatrixWorld();
    }

    for (let i = 0; i < targets.current.length; i++) {
      const mesh = targets.current[i];
      const id = projects[i].id;
      mesh.position.y = layout[id].y + (reducedMotion.matches || selected === id ? 0 : (0.16 + 0.045 * i) * Math.sin(time.current * (0.82 + 0.1 * i) + i * 2.2));
      mesh.rotation.y = rotations.current[id] + (reducedMotion.matches ? 0 : 0.045 * Math.sin(time.current * 0.43 + i));
      mesh.updateMatrixWorld();
    }

    const tip = cursor.current;
    if (tip) {
      tip.hidden = !input.pointing;
      if (input.pointing) tip.style.transform = `translate(${(input.cursor.x + 1) * size.width / 2 - 6}px, ${(1 - input.cursor.y) * size.height / 2 - 6}px)`;
    }
    const selection = input.consumeSelection();
    if (selection) {
      const id = pick(selection, camera, targets.current);
      onSelect(focused && id !== focused.id ? null : id);
      input.reportPick(id);
    }
    const aim = input.pointing ? input.cursor : pointerInside.current ? pointer : null;
    const id = drag.current?.id ?? (aim ? pick(aim, camera, targets.current) : null);
    if (lastHover.current !== id) {
      lastHover.current = id;
      gl.domElement.style.cursor = id ? "grab" : "";
      onHover(id);
    }
  });

  return (
    <>
      <color attach="background" args={ ["#19253a"] } />
      <fog attach="fog" args={ ["#19253a", 29, 98] } />
      <hemisphereLight args={ ["#d8e8ff", "#61657e", 1.6] } />
      <directionalLight position={ [-6, 9, 6] } color="#e2f3ff" intensity={ 2.15 } />
      <directionalLight position={ [5, 3, -4] } color="#a99ce2" intensity={ 1.1 } />
      <pointLight position={ [-10, 5, -9] } color="#9ac9ff" intensity={ 200 } distance={ 58 } />
      <pointLight position={ [17, 7, -24] } color="#b8a5ff" intensity={ 230 } distance={ 64 } />
      <mesh geometry={ assets.room } position-y={ layout.floor }>
        <meshStandardMaterial vertexColors roughness={ 0.9 } />
      </mesh>
      <group ref={ exhibits }>
        { projects.map((project) => {
          const { id } = project;
          const radius = "model" in project ? project.model.span / 2 : assets[project.id].boundingSphere!.radius;
          return (
            <group key={ id } userData={ { projectId: id, focusRadius: radius } }
              position={ [layout[id].x, layout[id].y, layout[id].z] } scale={ layout[id].scale }
              rotation={ [id === "phase" ? 0.08 : 0.19, rotations.current[id], 0] }>
              { "model" in project ? (
                <Suspense fallback={ null }><ProjectModel { ...project.model } /></Suspense>
              ) : (
                <mesh geometry={ assets[project.id] }>
                  <meshStandardMaterial vertexColors metalness={ 0.28 } roughness={ 0.52 } emissive={ active === id ? "#232039" : "#000000" } />
                </mesh>
              ) }
            </group>
          );
        }) }
      </group>
      { projects.map(({ id }) => (
        <group key={ id } position={ [layout[id].x, layout.floor + 0.018, layout[id].z] } rotation-x={ -Math.PI / 2 } scale={ layout[id].scale }>
          <mesh><planeGeometry args={ [5, 4] } /><meshBasicMaterial map={ assets.shadow } transparent depthWrite={ false } /></mesh>
          <mesh visible={ active === id } position-z={ 0.003 }><ringGeometry args={ [1.91, 1.925, 80] } /><meshBasicMaterial color={ active === id ? "#ac9cdd" : "#62758e" } transparent opacity={ 0.48 } depthWrite={ false } /></mesh>
        </group>
      )) }
    </>
  );
};

export default GalleryWorld;
