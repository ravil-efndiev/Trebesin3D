import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DataTexture, Group, LinearFilter, Mesh, RGBAFormat, Vector2 } from "three";
import { galleryGeometry, projectGeometry } from "../scene/geometry.ts";
import { createPicker, homeView, moveView, travel, turnView } from "../scene/interaction.ts";
import type { SceneInput } from "../scene/handInput.ts";
import { galleryLayout, projects, type ProjectId } from "../scene/projects.ts";

interface Props {
  input: SceneInput;
  active: ProjectId | null;
  rotations: RefObject<Record<ProjectId, number>>;
  cursor: RefObject<HTMLSpanElement | null>;
  onHover: (id: ProjectId | null) => void;
  onSelect: (id: ProjectId | null) => void;
  onUnavailable: () => void;
}

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

const GalleryWorld = ({ input, active, rotations, cursor, onHover, onSelect, onUnavailable }: Props) => {
  const { camera, gl, size } = useThree();
  const exhibits = useRef<Group>(null);
  const targets = useRef<Mesh[]>([]);
  const lastHover = useRef<ProjectId | null>(null);
  const view = useMemo(homeView, []);
  const pick = useMemo(createPicker, []);
  const pointer = useMemo(() => new Vector2(), []);
  const pointerInside = useRef(false);
  const drag = useRef<{ id: ProjectId | null; x: number; pointerId: number } | null>(null);
  const time = useRef(0);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)"), []);
  const layout = useMemo(() => galleryLayout(size.width, size.height), [size.width, size.height]);
  const assets = useMemo(() => ({
    helix: projectGeometry.helix(), phase: projectGeometry.phase(), house: projectGeometry.house(),
    room: galleryGeometry(), shadow: shadowTexture(),
  }), []);

  useEffect(() => () => { Object.values(assets).forEach((asset) => asset.dispose()); }, [assets]);
  useLayoutEffect(() => {
    targets.current = exhibits.current!.children.filter((child): child is Mesh => child instanceof Mesh);
  }, []);
  useLayoutEffect(() => {
    travel(view, 0, 0, 0, layout.floor);
  }, [view, layout.floor]);

  useEffect(() => {
    const canvas = gl.domElement;
    const toPointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.set(2 * (event.clientX - bounds.left) / bounds.width - 1, 1 - 2 * (event.clientY - bounds.top) / bounds.height);
    };
    const release = () => {
      const held = drag.current;
      drag.current = null;
      if (held && canvas.hasPointerCapture(held.pointerId)) canvas.releasePointerCapture(held.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      toPointer(event);
      pointerInside.current = true;
      const held = drag.current;
      if (!held || held.pointerId !== event.pointerId) return;
      const dx = event.clientX - held.x;
      if (held.id) rotations.current[held.id] += dx * 0.013;
      else turnView(view, dx * 0.005);
      held.x = event.clientX;
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      toPointer(event);
      const id = pick(pointer, camera, targets.current);
      onSelect(id);
      canvas.focus({ preventScroll: true });
      drag.current = { id, x: event.clientX, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    };
    const leave = () => { pointerInside.current = false; };
    const up = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      release();
      if (event.pointerType === "touch") leave();
    };
    const reset = () => { release(); leave(); };
    const lost = (event: Event) => { event.preventDefault(); onUnavailable(); };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      travel(view, -Math.max(-200, Math.min(200, event.deltaY * unit)) * 0.032, 0, 0, layout.floor);
    };
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      switch (event.key.toLowerCase()) {
        case "w": travel(view, 1, 0, 0, layout.floor); break;
        case "s": travel(view, -1, 0, 0, layout.floor); break;
        case "a": travel(view, 0, -1, 0, layout.floor); break;
        case "d": travel(view, 0, 1, 0, layout.floor); break;
        case "arrowleft": turnView(view, -0.14); break;
        case "arrowright": turnView(view, 0.14); break;
        case "home": Object.assign(view, homeView()); break;
        default: return;
      }
      event.preventDefault();
    };
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Explore the gallery. Drag empty space to look around. Scroll to move, or use W A S D and the left and right arrows. Home resets the view.");
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("keydown", key);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointercancel", reset);
    canvas.addEventListener("lostpointercapture", release);
    canvas.addEventListener("webglcontextlost", lost);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("keydown", key);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", reset);
      canvas.removeEventListener("lostpointercapture", release);
      canvas.removeEventListener("webglcontextlost", lost);
      window.removeEventListener("blur", reset);
    };
  }, [camera, gl, onSelect, onUnavailable, pick, pointer, rotations, view, layout.floor, size.height]);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.05);
    time.current += step;
    moveView(view, input.gesture, delta, layout.floor);
    camera.position.set(view.x, view.y, view.z);
    camera.rotation.y = -view.yaw;
    camera.updateMatrixWorld();

    for (let i = 0; i < targets.current.length; i++) {
      const mesh = targets.current[i];
      const id = projects[i].id;
      mesh.position.y = layout[id].y + (reducedMotion.matches ? 0 : (0.16 + 0.045 * i) * Math.sin(time.current * (0.82 + 0.1 * i) + i * 2.2));
      mesh.rotation.y = rotations.current[id] + (reducedMotion.matches ? 0 : 0.045 * Math.sin(time.current * 0.43 + i));
      mesh.updateMatrixWorld();
    }

    const tip = cursor.current;
    if (tip) {
      tip.hidden = !input.pointing;
      if (input.pointing) tip.style.transform = `translate(${(input.cursor.x + 1) * size.width / 2 - 6}px, ${(1 - input.cursor.y) * size.height / 2 - 6}px)`;
    }
    const selection = input.consumeSelection();
    if (selection) onSelect(pick(selection, camera, targets.current));
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
        { projects.map(({ id }) => (
          <mesh key={ id } geometry={ assets[id] } userData={ { projectId: id } }
            position={ [layout[id].x, layout[id].y, layout[id].z] } scale={ layout[id].scale }
            rotation={ [id === "phase" ? 0.08 : 0.19, rotations.current[id], 0] }>
            <meshStandardMaterial vertexColors metalness={ 0.28 } roughness={ 0.52 } emissive={ active === id ? "#232039" : "#000000" } />
          </mesh>
        )) }
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
