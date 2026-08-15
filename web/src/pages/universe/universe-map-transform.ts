export type UniverseViewport = {
  x: number;
  y: number;
  scale: number;
};

export type UniverseMapSize = {
  width: number;
  height: number;
};

export type UniversePoint = {
  x: number;
  y: number;
};

export const MIN_UNIVERSE_SCALE = 0.2;
export const MAX_UNIVERSE_SCALE = 4;
export const UNIVERSE_VIEWPORT_STORAGE_KEY = "leileios.universe.viewport.v1";

// Canonical positions are percentages in a 0..100 logical coordinate space.
// Keeping the conversion in one place lets the renderer use a larger world
// without changing the persisted Universe contract.
const WORLD_UNITS_PER_CANONICAL_UNIT = 10;

export function clampUniverseCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function clampUniversePosition(position: UniversePoint): UniversePoint {
  return {
    x: clampUniverseCoordinate(position.x),
    y: clampUniverseCoordinate(position.y),
  };
}

export function canonicalPositionToWorld(position: UniversePoint): UniversePoint {
  return {
    x: position.x * WORLD_UNITS_PER_CANONICAL_UNIT,
    y: position.y * WORLD_UNITS_PER_CANONICAL_UNIT,
  };
}

export function worldToCanonicalPosition(world: UniversePoint): UniversePoint {
  return clampUniversePosition({
    x: world.x / WORLD_UNITS_PER_CANONICAL_UNIT,
    y: world.y / WORLD_UNITS_PER_CANONICAL_UNIT,
  });
}

export function clampUniverseScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_UNIVERSE_SCALE, Math.max(MIN_UNIVERSE_SCALE, scale));
}

export function worldToScreen(world: UniversePoint, viewport: UniverseViewport): UniversePoint {
  return {
    x: world.x * clampUniverseScale(viewport.scale) + viewport.x,
    y: world.y * clampUniverseScale(viewport.scale) + viewport.y,
  };
}

/** Keep the current zoom while applying the smallest pan that reveals a point. */
export function revealWorldPoint(
  viewport: UniverseViewport,
  world: UniversePoint,
  mapSize: UniverseMapSize,
  padding = 48,
): UniverseViewport {
  if (mapSize.width <= 0 || mapSize.height <= 0) return viewport;
  const screen = worldToScreen(world, viewport);
  let x = viewport.x;
  let y = viewport.y;
  if (screen.x < padding) x += padding - screen.x;
  else if (screen.x > mapSize.width - padding) x -= screen.x - (mapSize.width - padding);
  if (screen.y < padding) y += padding - screen.y;
  else if (screen.y > mapSize.height - padding) y -= screen.y - (mapSize.height - padding);
  return { ...viewport, x, y };
}

export function screenToWorld(screen: UniversePoint, viewport: UniverseViewport): UniversePoint {
  const scale = clampUniverseScale(viewport.scale);
  return {
    x: (screen.x - viewport.x) / scale,
    y: (screen.y - viewport.y) / scale,
  };
}

export function zoomAroundScreenPoint(
  viewport: UniverseViewport,
  screenPoint: UniversePoint,
  requestedScale: number,
): UniverseViewport {
  const before = screenToWorld(screenPoint, viewport);
  const scale = clampUniverseScale(requestedScale);
  return {
    scale,
    x: screenPoint.x - before.x * scale,
    y: screenPoint.y - before.y * scale,
  };
}

export function fitViewportToPositions(
  positions: readonly UniversePoint[],
  mapSize: UniverseMapSize,
  padding = 24,
): UniverseViewport {
  const worldPositions = positions.map(canonicalPositionToWorld);
  if (worldPositions.length === 0 || mapSize.width <= 0 || mapSize.height <= 0) {
    return { x: mapSize.width / 2, y: mapSize.height / 2, scale: 1 };
  }

  const xs = worldPositions.map((point) => point.x);
  const ys = worldPositions.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const availableWidth = Math.max(1, mapSize.width - padding * 2);
  const availableHeight = Math.max(1, mapSize.height - padding * 2);
  const scale = clampUniverseScale(Math.min(
    availableWidth / Math.max(1, maxX - minX),
    availableHeight / Math.max(1, maxY - minY),
  ));
  const centerWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  return {
    scale,
    x: mapSize.width / 2 - centerWorld.x * scale,
    y: mapSize.height / 2 - centerWorld.y * scale,
  };
}

export function parseUniverseViewport(value: unknown): UniverseViewport | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  if (typeof record.x !== "number" || !Number.isFinite(record.x)) return null;
  if (typeof record.y !== "number" || !Number.isFinite(record.y)) return null;
  if (typeof record.scale !== "number" || !Number.isFinite(record.scale) || record.scale <= 0) return null;
  return {
    x: record.x,
    y: record.y,
    scale: clampUniverseScale(record.scale),
  };
}

export function serializeUniverseViewport(viewport: UniverseViewport): string {
  const safe = parseUniverseViewport(viewport) ?? { x: 0, y: 0, scale: 1 };
  return JSON.stringify(safe);
}
