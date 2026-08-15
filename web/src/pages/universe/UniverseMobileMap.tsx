import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import { canonicalPositionToWorld, fitViewportToPositions, parseUniverseViewport, screenToWorld, serializeUniverseViewport, worldToCanonicalPosition, worldToScreen, zoomAroundScreenPoint, type UniversePoint, type UniverseViewport } from "./universe-map-transform";
import { deriveGalaxyFocus, derivePlanetPresentation, deriveRelationPresentation, getDirectNeighborIds, getPrimaryGalaxy, sortMembershipsByVisualPriority } from "./universe-map-presentation";
import type { UniverseMapMode } from "./universe-map-interaction";

export type UniverseMobileMapProps = {
  galaxies: UniverseGalaxy[];
  nodes: UniverseNode[];
  relations: UniverseRelation[];
  selectedNodeId: string | null;
  activeGalaxyId: string | null;
  mode: UniverseMapMode;
  initialViewport: UniverseViewport | null;
  onViewportChange(viewport: UniverseViewport): void;
  onSelectNode(nodeId: string | null): void;
  onOpenNode(nodeId: string): void;
  onPlaceNode(position: UniversePoint): void;
  onChooseRelationTarget(nodeId: string): void;
  onMoveNode(nodeId: string, position: UniversePoint): Promise<void>;
};

type PointerPoint = UniversePoint & { pointerId: number };

const DEFAULT_MAP_SIZE = { width: 390, height: 520 };
const LONG_PRESS_MS = 450;

export function UniverseMobileMap({
  galaxies,
  nodes,
  relations,
  selectedNodeId,
  activeGalaxyId,
  mode,
  initialViewport,
  onViewportChange,
  onSelectNode,
  onOpenNode,
  onPlaceNode,
  onChooseRelationTarget,
  onMoveNode,
}: UniverseMobileMapProps) {
  const mapRef = useRef<HTMLElement>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const panRef = useRef<{ pointerId: number; start: UniversePoint; viewport: UniverseViewport } | null>(null);
  const pinchRef = useRef<{ distance: number; viewport: UniverseViewport } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movingRef = useRef<{ nodeId: string; pointerId: number } | null>(null);
  const [mapSize, setMapSize] = useState(DEFAULT_MAP_SIZE);
  const [viewport, setViewport] = useState<UniverseViewport>(initialViewport ?? { x: 0, y: 0, scale: 1 });
  const [dragPositions, setDragPositions] = useState<Record<string, UniversePoint>>({});
  const didFit = useRef(Boolean(initialViewport));

  const updateViewport = useCallback((next: UniverseViewport) => {
    setViewport(next);
    onViewportChange(next);
    try {
      window.localStorage.setItem("leileios.universe.viewport.v1", serializeUniverseViewport(next));
    } catch {
      // Viewport persistence is only a preference; private browsing may deny it.
    }
  }, [onViewportChange]);

  useLayoutEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setMapSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (didFit.current) return;
    let stored: UniverseViewport | null = null;
    try { stored = parseUniverseViewport(window.localStorage.getItem("leileios.universe.viewport.v1")); } catch { /* ignored */ }
    const next = stored ?? fitViewportToPositions(nodes.map((node) => node.position), mapSize);
    didFit.current = true;
    updateViewport(next);
  }, [mapSize, nodes, updateViewport]);

  useEffect(() => () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }, []);

  const fitAll = () => updateViewport(fitViewportToPositions(nodes.map((node) => node.position), mapSize));
  const pointFromEvent = (event: ReactPointerEvent<HTMLElement>): UniversePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const clearGesture = (event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (movingRef.current?.pointerId === event.pointerId) movingRef.current = null;
    panRef.current = null;
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointFromEvent(event);
    pointers.current.set(event.pointerId, { ...point, pointerId: event.pointerId });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 1 && event.target === event.currentTarget) {
      panRef.current = { pointerId: event.pointerId, start: point, viewport };
      return;
    }
    if (pointers.current.size === 2) {
      const [first, second] = [...pointers.current.values()];
      pinchRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), viewport };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointFromEvent(event);
    pointers.current.set(event.pointerId, { ...point, pointerId: event.pointerId });
    const moving = movingRef.current;
    if (moving) {
      const world = screenToWorld(point, viewport);
      const canonical = worldToCanonicalPosition(world);
      setDragPositions((current) => ({ ...current, [moving.nodeId]: canonical }));
      return;
    }
    if (pointers.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      updateViewport(zoomAroundScreenPoint(pinchRef.current.viewport, midpoint, pinchRef.current.viewport.scale * distance / Math.max(1, pinchRef.current.distance)));
      return;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      updateViewport({ ...panRef.current.viewport, x: panRef.current.viewport.x + point.x - panRef.current.start.x, y: panRef.current.viewport.y + point.y - panRef.current.start.y });
    }
  };

  const handlePointerUp = async (event: ReactPointerEvent<HTMLElement>) => {
    const moving = movingRef.current;
    if (moving?.pointerId === event.pointerId) {
      const point = pointFromEvent(event);
      const position = worldToCanonicalPosition(screenToWorld(point, viewport));
      setDragPositions((current) => { const next = { ...current }; delete next[moving.nodeId]; return next; });
      movingRef.current = null;
      await onMoveNode(moving.nodeId, position);
    }
    clearGesture(event);
  };

  const handleMapClick = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const world = screenToWorld(pointFromEvent(event), viewport);
    if (mode.kind === "placing-node") onPlaceNode(worldToCanonicalPosition(world));
    else if (mode.kind === "browse") onSelectNode(null);
  };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const directNeighbors = getDirectNeighborIds(selectedNodeId, relations);
  const screenPosition = (node: UniverseNode) => worldToScreen(canonicalPositionToWorld(dragPositions[node.id] ?? node.position), viewport);

  return (
    <section className="universe-mobile-map" ref={mapRef} aria-label="Universe spatial map" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => { void handlePointerUp(event); }} onPointerCancel={clearGesture} onClick={handleMapClick}>
      <div className="universe-mobile-map-toolbar"><button type="button" className="universe-map-fit" onClick={fitAll}>查看全部</button></div>
      <div className="universe-map-reference-dots" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 96}%`, top: `${(index * 53) % 92}%` }} />)}</div>
      <div className="universe-map-relations" aria-hidden="true">
        {relations.map((relation) => {
          const source = nodeMap.get(relation.source);
          const target = nodeMap.get(relation.target);
          if (!source || !target) return null;
          const start = screenPosition(source);
          const end = screenPosition(target);
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const presentation = deriveRelationPresentation(relation, selectedNodeId);
          return <span className={presentation.isEmphasized ? "universe-map-relation is-emphasized" : "universe-map-relation"} key={relation.id} style={{ left: start.x, top: start.y, width: Math.hypot(dx, dy), transform: `rotate(${Math.atan2(dy, dx) * 180 / Math.PI}deg)`, opacity: presentation.opacity, height: presentation.width }} />;
        })}
      </div>
      <div className="universe-map-planets">
        {nodes.map((node) => {
          const primary = getPrimaryGalaxy(node, galaxies);
          const memberships = sortMembershipsByVisualPriority(node.galaxies, galaxies);
          const visual = derivePlanetPresentation(node, viewport.scale);
          const focus = deriveGalaxyFocus(node, activeGalaxyId, selectedNodeId, directNeighbors);
          const point = screenPosition(node);
          const color = primary?.color ?? "#9a9a9a";
          return <button
            className={`universe-map-planet${focus.isSelected ? " is-selected" : ""}${focus.isFaded ? " is-faded" : ""}`}
            key={node.id}
            type="button"
            aria-label={`查看节点：${node.title}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (mode.kind !== "browse") return;
              longPressRef.current = setTimeout(() => {
                movingRef.current = { nodeId: node.id, pointerId: event.pointerId };
                if (typeof navigator !== "undefined") navigator.vibrate?.(8);
              }, LONG_PRESS_MS);
            }}
            onPointerUp={(event) => { event.stopPropagation(); }}
            onClick={(event) => {
              event.stopPropagation();
              if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
              if (mode.kind === "relation-target") onChooseRelationTarget(node.id);
              else if (mode.kind === "placing-node") return;
              else if (selectedNodeId === node.id) onOpenNode(node.id);
              else onSelectNode(node.id);
            }}
            style={{ left: point.x, top: point.y, width: visual.radius * 2, height: visual.radius * 2, opacity: focus.opacity, "--planet-color": color } as CSSProperties}
          >
            {memberships.slice(1).map((membership, index) => <span className="universe-map-membership-ring" key={membership.id} style={{ inset: -5 - index * 4, opacity: Math.min(0.9, 0.25 + membership.weight * 0.5), borderColor: galaxies.find((galaxy) => galaxy.id === membership.id)?.color ?? "#bdbdbd" }} />)}
            <span className="universe-map-planet-core" />
            {visual.showTitle ? <span className="universe-map-planet-title">{node.title}</span> : null}
          </button>;
        })}
      </div>
    </section>
  );
}
