import type { ReactNode } from "react";
import { X } from "lucide-react";
import { projects, type ProjectId } from "../scene/projects.ts";

interface Props {
  active: ProjectId | null;
  selected: ProjectId | null;
  onClear: () => void;
  children: ReactNode;
}

const GallerySidebar = ({ active, selected, onClear, children }: Props) => {
  const project = projects.find(({ id }) => id === active);

  return (
    <aside aria-label="Camera and project details" className="absolute top-3 right-3 z-10 grid max-h-[calc(100%-1.5rem)] w-[clamp(9.5rem,41vw,14rem)] gap-2 overflow-y-auto overscroll-contain sm:top-6 sm:right-6 sm:max-h-[calc(100%-3rem)] sm:w-[clamp(12rem,19vw,16rem)]">
      { children }
      { project && (
        <section aria-labelledby="project-name" className="relative rounded-[4px] border border-edge bg-panel px-3 py-3.5 shadow-lg before:absolute before:top-4 before:-left-px before:h-5 before:w-0.5 before:bg-accent sm:px-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-accent">{ project.field }</span>
            { selected === active && <button type="button" onClick={ onClear } aria-label="Clear project selection" className="-my-1 -mr-1 grid size-7 place-items-center rounded-sm text-muted hover:text-white"><X size={ 16 } aria-hidden="true" /></button> }
          </div>
          <h2 id="project-name" className="my-2 text-xl leading-tight font-medium tracking-tight sm:text-2xl">{ project.name }</h2>
          <p className="text-sm leading-relaxed text-muted">{ project.description }</p>
          <p className="mt-3 font-mono text-xs text-[#99acbf]">{ project.collection }</p>
          { "externalLink" in project && <a href={ project.externalLink } target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-accent underline hover:text-white">See more</a> }
        </section>
      ) }
    </aside>
  );
};

export default GallerySidebar;
