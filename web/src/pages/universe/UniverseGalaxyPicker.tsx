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
  return (
    <div className="universe-galaxy-picker">
      <button className="universe-galaxy-entry" type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        <span className="universe-galaxy-entry-label">星系</span>
        {active ? <><span className="universe-galaxy-entry-dot" style={{ background: active.color }} />{active.title}</> : null}
      </button>
      {open ? (
        <>
          <button className="universe-galaxy-backdrop" type="button" aria-label="关闭星系选择" onClick={() => onOpenChange(false)} />
          <div className="universe-galaxy-menu" role="dialog" aria-modal="true" aria-label="选择星系">
            <button type="button" className={!activeGalaxyId ? "is-active" : ""} onClick={() => { onSelect(null); onOpenChange(false); }}>全部</button>
            {galaxies.slice().sort((left, right) => left.order - right.order).map((galaxy) => (
              <button type="button" className={activeGalaxyId === galaxy.id ? "is-active" : ""} key={galaxy.id} onClick={() => { onSelect(galaxy.id); onOpenChange(false); }}>
                <span className="universe-galaxy-entry-dot" style={{ background: galaxy.color }} />{galaxy.title}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
