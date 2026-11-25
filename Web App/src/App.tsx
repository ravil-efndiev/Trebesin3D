import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import GallerySidebar from "./components/GallerySidebar.tsx";
import CameraPanel from "./components/CameraPanel.tsx";
import { createSceneInput } from "./scene/handInput.ts";
import type { ProjectId } from "./scene/projects.ts";
import brand from "./assets/trebesin.svg";
import gallery from "./assets/gallery.webp";

const PortfolioScene = lazy(() => import("./components/PortfolioScene.tsx"));
const selectDebug = new URLSearchParams(window.location.search).get("debug") === "select";

const App = () => {
  const [pickStatus, setPickStatus] = useState("");
  const [input] = useState(() => createSceneInput(selectDebug ? setPickStatus : undefined));
  const [hovered, setHovered] = useState<ProjectId | null>(null);
  const [selected, setSelected] = useState<ProjectId | null>(null);
  const [focused, setFocused] = useState<ProjectId | null>(null);
  const active = selected ?? focused ?? hovered;
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
        <PortfolioScene input={ input } active={ active } selected={ selected } onHover={ setHovered } onSelect={ setSelected } onFocus={ setFocused } />
      </Suspense>
      <GallerySidebar active={ active } selected={ selected } onClear={ clear }>
        <CameraPanel onTracking={ input.observe } selectDebug={ selectDebug } pickStatus={ pickStatus } onPickStatus={ setPickStatus } />
      </GallerySidebar>
    </main>
  );
};

export default App;
