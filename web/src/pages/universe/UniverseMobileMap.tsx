import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "./universe-types";
import { canonicalPositionToWorld, fitViewportToPositions, parseUniverseViewport, revealWorldPoint, screenToWorld, serializeUniverseViewport, worldToCanonicalPosition, zoomAroundScreenPoint, type UniversePoint, type UniverseViewport } from "./universe-map-transform";
import { deriveGalaxyFocus, derivePlanetPresentation, deriveRelationPresentation, getDirectNeighborIds, getPrimaryGalaxy, relationTypeLabel, sortMembershipsByVisualPriority } from "./universe-map-presentation";
import { initialUniverseMapInteraction, reduceUniverseMapInteraction, type UniverseMapAction, type UniverseMapInteractionState, type UniverseMapMode } from "./universe-map-interaction";

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
  onMoveNode(nodeId: string, position: UniversePoint): Promise<void>;
  onModeChange?(mode: UniverseMapMode): void;
  revealNodeId?: string | null;
  onRevealNodeHandled?(): void;
};

type PointerPoint = UniversePoint & { pointerId: number };

const LONG_PRESS_MS = 450;
const MOVEMENT_TOLERANCE_PX = 8;

function sameMode(left: UniverseMapMode, right: UniverseMapMode): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "moving-node" && right.kind === "moving-node") return left.nodeId === right.nodeId;
  return true;
}

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
  onMoveNode,
  onModeChange,
  revealNodeId = null,
  onRevealNodeHandled,
}: UniverseMobileMapProps) {
  const mapRef = useRef<HTMLElement>(null);
  const pointers = useRef(new Map<number, PointerPoint>());
  const panRef = useRef<{ pointerId: number; start: UniversePoint; viewport: UniverseViewport } | null>(null);
  const pinchRef = useRef<{ distance: number; viewport: UniverseViewport } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movingRef = useRef<{ nodeId: string; pointerId: number } | null>(null);
  const mapGestureRef = useRef<{ pointerId: number; start: UniversePoint; moved: boolean } | null>(null);
  const planetGestureRef = useRef<{ pointerId: number; nodeId: string; start: UniversePoint; moved: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<UniverseViewport>(initialViewport ?? { x: 0, y: 0, scale: 1 });
  const [dragPositions, setDragPositions] = useState<Record<string, UniversePoint>>({});
  const [interaction, setInteraction] = useState<UniverseMapInteractionState>(() => ({ ...initialUniverseMapInteraction(), mode, selectedNodeId }));
  const interactionRef = useRef(interaction);
  const didFit = useRef(Boolean(initialViewport));

  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  useEffect(() => {
    setInteraction((current) => (
      sameMode(current.mode, mode) && current.selectedNodeId === selectedNodeId
        ? current
        : { mode, selectedNodeId }
    ));
    interactionRef.current = { mode, selectedNodeId };
  }, [mode, selectedNodeId]);

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
    if (mapSize.width <= 0 || mapSize.height <= 0) return;
    let stored: UniverseViewport | null = null;
    const useStoredMobileViewport = window.matchMedia("(max-width: 760px)").matches;
    if (useStoredMobileViewport) {
      try { stored = parseUniverseViewport(window.localStorage.getItem("leileios.universe.viewport.v1")); } catch { /* ignored */ }
    }
    const next = stored ?? fitViewportToPositions(nodes.map((node) => node.position), mapSize);
    didFit.current = true;
    updateViewport(next);
  }, [mapSize, nodes, updateViewport]);

  useEffect(() => {
    if (!revealNodeId) return;
    const node = nodes.find((candidate) => candidate.id === revealNodeId);
    if (!node) {
      onRevealNodeHandled?.();
      return;
    }
    const next = revealWorldPoint(viewport, canonicalPositionToWorld(dragPositions[node.id] ?? node.position), mapSize);
    if (next.x !== viewport.x || next.y !== viewport.y) updateViewport(next);
    onRevealNodeHandled?.();
  }, [dragPositions, mapSize, nodes, onRevealNodeHandled, revealNodeId, updateViewport, viewport]);

  useEffect(() => () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
  }, []);

  const dispatchInteraction = useCallback((action: UniverseMapAction, pointerId?: number) => {
    const current = interactionRef.current;
    const transition = reduceUniverseMapInteraction(current, action);
    interactionRef.current = transition.state;
    setInteraction(transition.state);
    if (transition.state.selectedNodeId !== current.selectedNodeId) onSelectNode(transition.state.selectedNodeId);
    if (!sameMode(transition.state.mode, current.mode)) onModeChange?.(transition.state.mode);
    for (const effect of transition.effects) {
      if (effect.type === "open-node") onOpenNode(effect.nodeId);
      if (effect.type === "create-node") onPlaceNode(effect.world);
      if (effect.type === "begin-move") movingRef.current = { nodeId: effect.nodeId, pointerId: pointerId ?? -1 };
    }
  }, [onModeChange, onOpenNode, onPlaceNode, onSelectNode]);

  const fitAll = () => updateViewport(fitViewportToPositions(nodes.map((node) => node.position), mapSize));
  const pointFromEvent = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): UniversePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointFromMapEvent = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>): UniversePoint => {
    const rect = mapRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const clearGesture = (event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (movingRef.current?.pointerId === event.pointerId) movingRef.current = null;
    panRef.current = null;
    mapGestureRef.current = null;
    planetGestureRef.current = null;
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const point = pointFromEvent(event);
    pointers.current.set(event.pointerId, { ...point, pointerId: event.pointerId });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 1 && event.target === event.currentTarget) {
      panRef.current = { pointerId: event.pointerId, start: point, viewport };
      mapGestureRef.current = { pointerId: event.pointerId, start: point, moved: false };
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
      const gesture = planetGestureRef.current;
      if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > MOVEMENT_TOLERANCE_PX) gesture.moved = true;
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
      const gesture = mapGestureRef.current;
      if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > MOVEMENT_TOLERANCE_PX) {
        gesture.moved = true;
        suppressNextClickRef.current = true;
      }
      updateViewport({ ...panRef.current.viewport, x: panRef.current.viewport.x + point.x - panRef.current.start.x, y: panRef.current.viewport.y + point.y - panRef.current.start.y });
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const moving = movingRef.current;
    const planetGesture = planetGestureRef.current;
    if (moving?.pointerId === event.pointerId) {
      if (!planetGesture?.moved) {
        movingRef.current = null;
        suppressNextClickRef.current = true;
        clearGesture(event);
        return;
      }
      const point = pointFromMapEvent(event);
      const position = worldToCanonicalPosition(screenToWorld(point, viewport));
      setDragPositions((current) => { const next = { ...current }; delete next[moving.nodeId]; return next; });
      movingRef.current = null;
      suppressNextClickRef.current = true;
      const finishedMove = { mode: { kind: "browse" } as const, selectedNodeId: moving.nodeId };
      interactionRef.current = finishedMove;
      setInteraction(finishedMove);
      onModeChange?.(finishedMove.mode);
      clearGesture(event);
      void onMoveNode(moving.nodeId, position);
      return;
    }
    clearGesture(event);
  };

  const handleMapClick = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest?.(".universe-map-planet, .universe-mobile-map-toolbar, .universe-map-mode-hint")) return;
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const world = screenToWorld(pointFromEvent(event), viewport);
    dispatchInteraction({ type: "tap-empty", world: worldToCanonicalPosition(world) });
  };

  const handlePlanetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: UniverseNode) => {
    event.stopPropagation();
    const point = pointFromMapEvent(event);
    planetGestureRef.current = { pointerId: event.pointerId, nodeId: node.id, start: point, moved: false };
    if (interactionRef.current.mode.kind !== "browse") return;
    longPressRef.current = setTimeout(() => {
      const gesture = planetGestureRef.current;
      if (!gesture || gesture.moved) return;
      dispatchInteraction({ type: "long-press", nodeId: node.id, world: worldToCanonicalPosition(screenToWorld(point, viewport)) }, event.pointerId);
    }, LONG_PRESS_MS);
  };

  const handlePlanetPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const gesture = planetGestureRef.current;
    const point = pointFromMapEvent(event);
    if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > MOVEMENT_TOLERANCE_PX) {
      gesture.moved = true;
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      suppressNextClickRef.current = true;
    }
    const moving = movingRef.current;
    if (moving?.pointerId === event.pointerId) {
      setDragPositions((current) => ({ ...current, [moving.nodeId]: worldToCanonicalPosition(screenToWorld(point, viewport)) }));
    }
  };

  const handlePlanetPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    void handlePointerUp(event);
  };

  const handlePlanetClick = (event: ReactMouseEvent<HTMLButtonElement>, node: UniverseNode) => {
    event.stopPropagation();
    if (suppressNextClickRef.current) { suppressNextClickRef.current = false; return; }
    const point = pointFromMapEvent(event);
    dispatchInteraction({ type: "tap-planet", nodeId: node.id, world: worldToCanonicalPosition(screenToWorld(point, viewport)) }, event.detail);
  };

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const activeMode = interaction.mode;
  const activeSelectedNodeId = interaction.selectedNodeId;
  const directNeighbors = getDirectNeighborIds(activeSelectedNodeId, relations);
  const screenPosition = (node: UniverseNode) => canonicalPositionToWorld(dragPositions[node.id] ?? node.position);
  const modeHint = activeMode.kind === "moving-node" ? "拖动星球调整位置，松手保存" : null;

  return (
    <section className="universe-mobile-map" ref={mapRef} aria-label="Universe spatial map" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={(event) => { void handlePointerUp(event); }} onPointerCancel={clearGesture} onClick={handleMapClick}>
      <div className="universe-mobile-map-toolbar"><button type="button" className="universe-map-fit" onClick={fitAll}>查看全部</button></div>
      {modeHint ? <div className="universe-map-mode-hint" role="status"><span>{modeHint}</span><button type="button" aria-label="取消" onClick={() => dispatchInteraction({ type: "cancel" })}>取消</button></div> : null}
      <div className="universe-map-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
      <div className="universe-map-reference-dots" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ left: `${(index * 37) % 96}%`, top: `${(index * 53) % 92}%` }} />)}</div>
      <div className="universe-map-relations" aria-hidden={activeSelectedNodeId === null ? "true" : undefined}>
        {relations.map((relation) => {
          const source = nodeMap.get(relation.source);
          const target = nodeMap.get(relation.target);
          if (!source || !target) return null;
          const start = screenPosition(source);
          const end = screenPosition(target);
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          const presentation = deriveRelationPresentation(relation, activeSelectedNodeId);
          return <span className={presentation.isEmphasized ? "universe-map-relation is-emphasized" : "universe-map-relation is-muted"} key={relation.id} aria-label={`${source.title} → ${target.title}：${relationTypeLabel(relation.relationType)}`} style={{ left: start.x, top: start.y, width: Math.hypot(dx, dy), transform: `rotate(${angle}deg)`, opacity: presentation.opacity, height: presentation.width }}><span className="universe-map-relation-label" style={{ transform: `translateX(-50%) rotate(${-angle}deg)` }}>{relationTypeLabel(relation.relationType)}</span><span className="universe-map-relation-arrow" aria-hidden="true" /></span>;
        })}
      </div>
      <div className="universe-map-planets">
        {nodes.map((node) => {
          const primary = getPrimaryGalaxy(node, galaxies);
          const memberships = sortMembershipsByVisualPriority(node.galaxies, galaxies);
          const visual = derivePlanetPresentation(node, viewport.scale);
          const focus = deriveGalaxyFocus(node, activeGalaxyId, activeSelectedNodeId, directNeighbors);
          const point = screenPosition(node);
          const color = primary?.color ?? "#9a9a9a";
          return <button
            className={`universe-map-planet${focus.isSelected ? " is-selected" : ""}${focus.isFaded ? " is-faded" : ""}`}
            key={node.id}
            type="button"
            aria-label={`查看节点：${node.title}`}
            onPointerDown={(event) => handlePlanetPointerDown(event, node)}
            onPointerMove={handlePlanetPointerMove}
            onPointerUp={handlePlanetPointerUp}
            onClick={(event) => handlePlanetClick(event, node)}
            style={{ left: point.x, top: point.y, width: visual.radius * 2, height: visual.radius * 2, opacity: focus.opacity, "--planet-color": color } as CSSProperties}
          >
            {memberships.slice(1).map((membership, index) => <span className="universe-map-membership-ring" key={membership.id} style={{ inset: -5 - index * 4, opacity: Math.min(0.34, 0.1 + Math.max(0, membership.weight) * 0.18), borderColor: galaxies.find((galaxy) => galaxy.id === membership.id)?.color ?? "#bdbdbd" }} />)}
            <span className="universe-map-planet-core" />
            {visual.showTitle ? <span className="universe-map-planet-title">{node.title}</span> : null}
          </button>;
        })}
      </div>
      </div>
    </section>
  );
}
