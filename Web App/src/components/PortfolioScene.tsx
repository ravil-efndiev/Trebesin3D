import { Component, useCallback, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { fieldOfView, homeDepth, projects, type ProjectId } from "../scene/projects.ts";
import type { SceneInput } from "../scene/handInput.ts";
import GalleryWorld from "./GalleryWorld.tsx";

interface Props {
  input: SceneInput;
  active: ProjectId | null;
  selected: ProjectId | null;
  onHover: (id: ProjectId | null) => void;
  onSelect: (id: ProjectId | null) => void;
  onFocus: (id: ProjectId | null) => void;
}

// R3F propagates renderer initialization errors to the nearest React boundary.
class RendererBoundary extends Component<{ children: ReactNode; onUnavailable: () => void }> {
  state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  componentDidCatch = () => this.props.onUnavailable();
  render = () => this.state.failed ? null : this.props.children;
}

const PortfolioScene = ({ input, active, selected, onHover, onSelect, onFocus }: Props) => {
  const cursor = useRef<HTMLSpanElement>(null);
  const rotations = useRef({ slotMachine: -1.4, albiLab: -0.32, omnicar: -0.52 });
  const [available, setAvailable] = useState(true);
  const unavailable = useCallback(() => {
    setAvailable(false);
    onHover(null);
    if (cursor.current) cursor.current.hidden = true;
  }, [onHover]);

  return (
    <>
      <div className="absolute inset-0 touch-none" aria-label="3D project gallery">
        { available && (
          <RendererBoundary onUnavailable={ unavailable }>
            <Canvas dpr={ [1, 1.5] } camera={ { position: [0, 0, homeDepth], fov: fieldOfView, near: 0.1, far: 100 } } gl={ { antialias: true, alpha: false } }>
              <GalleryWorld input={ input } active={ active } selected={ selected } rotations={ rotations } cursor={ cursor } onHover={ onHover } onSelect={ onSelect } onUnavailable={ unavailable } />
            </Canvas>
          </RendererBoundary>
        ) }
        <span ref={ cursor } hidden aria-hidden="true" className="pointer-events-none absolute top-0 left-0 size-3 rounded-full border-2 border-ice shadow-[0_0_0_2px_#17253d]" />
      </div>
      <nav aria-label="Browse projects" className={ `absolute bottom-4 left-4 z-10 max-w-[calc(100%-2rem)] rounded border border-edge bg-panel p-2 ${!available ? "" : "sr-only focus-within:not-sr-only focus-within:absolute"}` }>
        { !available && <p className="px-2 py-1 text-sm text-muted">Choose a project to explore.</p> }
        <div className="flex flex-wrap gap-1">
          { projects.map(({ id, name }) => (
            <button key={ id } type="button" className="rounded-sm px-2 py-1.5 text-sm hover:bg-raised focus:bg-raised"
              onFocus={ () => onFocus(id) } onBlur={ () => onFocus(null) } onClick={ () => onSelect(id) }
              onKeyDown={ (event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  rotations.current[id] += event.key === "ArrowLeft" ? -0.16 : 0.16;
                }
              } }>{ name }</button>
          )) }
        </div>
      </nav>
    </>
  );
};

export default PortfolioScene;
