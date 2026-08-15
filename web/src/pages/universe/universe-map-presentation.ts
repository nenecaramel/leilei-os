import type { UniverseGalaxy, UniverseGalaxyMembership, UniverseNode, UniverseRelation } from "./universe-types";

export type PlanetPresentation = {
  radius: number;
  showTitle: boolean;
};

export type GalaxyFocusPresentation = {
  isSelected: boolean;
  isNeighbor: boolean;
  isInFocus: boolean;
  isFaded: boolean;
  opacity: number;
};

export type RelationPresentation = {
  width: number;
  opacity: number;
  isEmphasized: boolean;
};

export function sortMembershipsByVisualPriority(
  memberships: readonly UniverseGalaxyMembership[],
  galaxies: readonly UniverseGalaxy[],
): UniverseGalaxyMembership[] {
  const galaxyOrder = new Map(galaxies.map((galaxy) => [galaxy.id, galaxy.order]));
  return [...memberships].sort((left, right) => (
    right.weight - left.weight
    || (galaxyOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (galaxyOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id)
  ));
}

export function getPrimaryGalaxy(
  node: Pick<UniverseNode, "galaxies">,
  galaxies: readonly UniverseGalaxy[],
): UniverseGalaxy | null {
  const byId = new Map(galaxies.map((galaxy) => [galaxy.id, galaxy]));
  return sortMembershipsByVisualPriority(node.galaxies, galaxies)
    .map((membership) => byId.get(membership.id))
    .find((galaxy): galaxy is UniverseGalaxy => galaxy !== undefined) ?? null;
}

export function getPlanetRadius(importance: string | undefined): number {
  switch (importance) {
    case "anchor": return 18;
    case "major": return 15;
    default: return 12;
  }
}

export function derivePlanetPresentation(
  node: Pick<UniverseNode, "importance">,
  zoom: number,
): PlanetPresentation {
  const safeZoom = Number.isFinite(zoom) ? zoom : 1;
  const showTitle = node.importance === "anchor"
    ? safeZoom >= 0.35
    : node.importance === "major"
      ? safeZoom >= 0.55
      : safeZoom >= 0.8;
  return { radius: getPlanetRadius(node.importance), showTitle };
}

export function deriveGalaxyFocus(
  node: Pick<UniverseNode, "id" | "galaxies">,
  activeGalaxyId: string | null,
  selectedNodeId: string | null,
  directNeighborIds: ReadonlySet<string> = new Set(),
): GalaxyFocusPresentation {
  const isSelected = node.id === selectedNodeId;
  const isNeighbor = directNeighborIds.has(node.id);
  const isInFocus = activeGalaxyId === null || node.galaxies.some((membership) => membership.id === activeGalaxyId);
  const isFaded = !isSelected && !isNeighbor && !isInFocus;
  return {
    isSelected,
    isNeighbor,
    isInFocus,
    isFaded,
    opacity: isSelected || isNeighbor || !isFaded ? 1 : 0.28,
  };
}

export function getDirectNeighborIds(
  selectedNodeId: string | null,
  relations: readonly Pick<UniverseRelation, "source" | "target">[],
): Set<string> {
  const ids = new Set<string>();
  if (!selectedNodeId) return ids;
  for (const relation of relations) {
    if (relation.source === selectedNodeId) ids.add(relation.target);
    if (relation.target === selectedNodeId) ids.add(relation.source);
  }
  return ids;
}

export function deriveRelationPresentation(
  relation: Pick<UniverseRelation, "source" | "target" | "strength">,
  selectedNodeId: string | null,
): RelationPresentation {
  const strength = Number.isFinite(relation.strength) ? Math.min(1, Math.max(0, relation.strength)) : 0;
  return {
    width: 1 + strength * 3,
    opacity: 0.18 + strength * 0.62,
    isEmphasized: selectedNodeId !== null && (relation.source === selectedNodeId || relation.target === selectedNodeId),
  };
}
