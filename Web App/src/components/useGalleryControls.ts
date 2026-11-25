import { useEffect, type RefObject } from "react";
import type { Camera, Object3D, Vector2 } from "three";
import { homeView, travel, turnFocus, turnView, zoomFocus } from "../scene/interaction.ts";
import type { createPicker, focusView } from "../scene/interaction.ts";
import type { ProjectId } from "../scene/projects.ts";

export interface GalleryDrag {
  id: ProjectId | null;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
  pointerId: number;
}

export interface GalleryFocus {
  id: ProjectId;
  view: ReturnType<typeof focusView>;
}

interface Props {
  canvas: HTMLCanvasElement;
  camera: Camera;
  view: ReturnType<typeof homeView>;
  floor: number;
  pivot: { x: number; z: number };
  viewportHeight: number;
  transition: { elapsed: number };
  focusTransitionSeconds: number;
  initialPivot: RefObject<{ x: number; z: number }>;
  targets: RefObject<Object3D[]>;
  pointer: Vector2;
  pointerInside: RefObject<boolean>;
  drag: RefObject<GalleryDrag | null>;
  focus: RefObject<GalleryFocus | null>;
  rotations: RefObject<Record<ProjectId, number>>;
  pick: ReturnType<typeof createPicker>;
  onSelect: (id: ProjectId | null) => void;
  onUnavailable: () => void;
}

const useGalleryControls = ({
  canvas, camera, view, floor, pivot, viewportHeight, transition, focusTransitionSeconds,
  initialPivot, targets, pointer, pointerInside, drag, focus, rotations, pick, onSelect, onUnavailable,
}: Props) => {
  useEffect(() => {
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
      if (!held.moved && Math.hypot(event.clientX - held.startX, event.clientY - held.startY) < 4) return;
      held.moved = true;
      const dx = event.clientX - held.x;
      const dy = event.clientY - held.y;
      if (focus.current) turnFocus(focus.current.view, dx * 0.005, dy * 0.005);
      else if (held.id) rotations.current[held.id] += dx * 0.013;
      else if (transition.elapsed >= focusTransitionSeconds) turnView(view, dx * 0.005);
      held.x = event.clientX;
      held.y = event.clientY;
    };

    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      toPointer(event);
      const id = pick(pointer, camera, targets.current);
      canvas.focus({ preventScroll: true });
      drag.current = { id, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    };

    const leave = () => { pointerInside.current = false; };
    const up = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const held = drag.current;
      if (held?.pointerId === event.pointerId && !held.moved) {
        onSelect(focus.current && held.id !== focus.current.id ? null : held.id);
      }
      release();
      if (event.pointerType === "touch") leave();
    };
    const reset = () => { release(); leave(); };
    const lost = (event: Event) => { event.preventDefault(); onUnavailable(); };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
      const step = -Math.max(-200, Math.min(200, event.deltaY * unit)) * 0.032;
      if (focus.current) zoomFocus(focus.current.view, step);
      else if (transition.elapsed >= focusTransitionSeconds) travel(view, step, 0, 0, floor);
    };

    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const focused = focus.current?.view;
      if (focused) {
        switch (event.key.toLowerCase()) {
          case "w": zoomFocus(focused, 1); break;
          case "s": zoomFocus(focused, -1); break;
          case "a": case "arrowleft": turnFocus(focused, -0.14); break;
          case "d": case "arrowright": turnFocus(focused, 0.14); break;
          case "arrowup": turnFocus(focused, 0, 0.14); break;
          case "arrowdown": turnFocus(focused, 0, -0.14); break;
          case "home": onSelect(null); break;
          default: return;
        }
        event.preventDefault();
        return;
      }
      if (transition.elapsed < focusTransitionSeconds) return;
      switch (event.key.toLowerCase()) {
        case "w": travel(view, 1, 0, 0, floor); break;
        case "s": travel(view, -1, 0, 0, floor); break;
        case "a": travel(view, 0, -1, 0, floor); break;
        case "d": travel(view, 0, 1, 0, floor); break;
        case "arrowleft": turnView(view, -0.14); break;
        case "arrowright": turnView(view, 0.14); break;
        case "home":
          Object.assign(view, homeView(pivot));
          initialPivot.current = pivot;
          break;
        default: return;
      }
      event.preventDefault();
    };

    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Explore the gallery. Drag empty space or use the left and right arrows to orbit. Scroll or use W A S D to move. Home resets the view.");
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
  }, [
    canvas, camera, view, floor, pivot, viewportHeight, transition, focusTransitionSeconds,
    initialPivot, targets, pointer, pointerInside, drag, focus, rotations, pick, onSelect, onUnavailable,
  ]);
};

export default useGalleryControls;
