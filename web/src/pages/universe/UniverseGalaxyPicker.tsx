import { useRef } from "react";
import "./universe-home-polish.css";
import { UniverseFloatingPopover } from "./UniverseFloatingPopover";
import type { UniverseGalaxy } from "./universe-types";

export function UniverseGalaxyPicker({
  galaxies,
  activeGalaxyId,
  open,
  onOpenChange,
  onSelect,
}: {
  galaxies: UniverseGalaxy[];
  activeGalaxyId: string | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(id: string | null): void;
}) {
  const active = galaxies.find((galaxy) => galaxy.id === activeGalaxyId);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="universe-galaxy-picker">
      <button ref={anchorRef} className="universe-galaxy-entry" type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <span className="universe-galaxy-entry-label">星系</span>
        {active ? <><span className="universe-galaxy-entry-dot" style={{ background: active.color }} />{active.title}</> : null}
      </button>
      <UniverseFloatingPopover open={open} anchorRef={anchorRef} className="universe-galaxy-menu" ariaLabel="选择星系" onRequestClose={() => onOpenChange(false)}>
        <button type="button" className={!activeGalaxyId ? "is-active" : ""} onClick={() => { onSelect(null); onOpenChange(false); }}>全部</button>
        {galaxies.slice().sort((left, right) => left.order - right.order).map((galaxy) => (
          <button type="button" className={activeGalaxyId === galaxy.id ? "is-active" : ""} key={galaxy.id} onClick={() => { onSelect(galaxy.id); onOpenChange(false); }}>
            <span className="universe-galaxy-entry-dot" style={{ background: galaxy.color }} />{galaxy.title}
          </button>
        ))}
      </UniverseFloatingPopover>
    </div>
  );
}
