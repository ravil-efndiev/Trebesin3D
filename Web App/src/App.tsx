import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import CameraView from "./components/CameraView.tsx";
import { createSceneInput } from "./scene/handInput.ts";
import { projects, type ProjectId } from "./scene/projects.ts";
import brand from "./assets/trebesin.svg";
import gallery from "./assets/gallery.webp";

const PortfolioScene = lazy(() => import("./components/PortfolioScene.tsx"));

const App = () => {
  const [input] = useState(createSceneInput);
  const [hovered, setHovered] = useState<ProjectId | null>(null);
  const [selected, setSelected] = useState<ProjectId | null>(null);
  const [focused, setFocused] = useState<ProjectId | null>(null);
  const active = focused ?? hovered ?? selected;
  const project = projects.find(({ id }) => id === active);
  const clear = useCallback(() => {
    setSelected(null);
    setFocused(null);
    setHovered(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") clear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  return (
    <main className="relative isolate h-svh min-h-80 overflow-hidden bg-[#172337] bg-cover bg-center"
      style={ { backgroundImage: `url(${gallery})` } }>
      <h1 className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 text-sm font-semibold tracking-widest uppercase sm:top-6 sm:left-6 sm:gap-2.5 sm:text-base">
        <img src={ brand } alt="" className="size-6 sm:size-8" />Trebesin <span className="border border-[#62758a] px-1 py-0.5 font-mono text-xs tracking-normal text-ice">3D</span>
      </h1>
      <Suspense fallback={ null }>
        <PortfolioScene input={ input } active={ active } onHover={ setHovered } onSelect={ setSelected } onFocus={ setFocused } />
      </Suspense>
      <aside aria-label="Camera and project details" className="absolute top-3 right-3 z-10 grid max-h-[calc(100%-1.5rem)] w-[clamp(9.5rem,41vw,14rem)] gap-2 overflow-y-auto overscroll-contain sm:top-6 sm:right-6 sm:max-h-[calc(100%-3rem)] sm:w-[clamp(12rem,19vw,16rem)]">
        <CameraView onTracking={ input.observe } />
        { project && (
          <section aria-labelledby="project-name" className="relative rounded-[4px] border border-edge bg-panel px-3 py-3.5 shadow-lg before:absolute before:top-4 before:-left-px before:h-5 before:w-0.5 before:bg-accent sm:px-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-accent">{ project.field }</span>
              { selected === active && <button type="button" onClick={ clear } aria-label="Clear project selection" className="-my-1 -mr-1 grid size-7 place-items-center rounded-sm text-muted hover:text-white"><X size={ 16 } aria-hidden="true" /></button> }
            </div>
            <h2 id="project-name" className="my-2 text-xl leading-tight font-medium tracking-tight sm:text-2xl">{ project.name }</h2>
            <p className="text-sm leading-relaxed text-muted">{ project.description }</p>
            <p className="mt-3 font-mono text-xs text-[#99acbf]">{ project.collection }</p>
          </section>
        ) }
      </aside>
    </main>
  );
};

export default App;
