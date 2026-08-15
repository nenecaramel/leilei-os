import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveGalaxyFocus,
  derivePlanetPresentation,
  deriveRelationPresentation,
  getDirectNeighborIds,
  getPrimaryGalaxy,
  getPlanetRadius,
  relationTypeLabel,
  sortMembershipsByVisualPriority,
} from "../web/src/pages/universe/universe-map-presentation.js";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "../web/src/pages/universe/universe-types.js";

const galaxies: UniverseGalaxy[] = [
  { id: "g1", title: "One", description: "", color: "#111", order: 0 },
  { id: "g2", title: "Two", description: "", color: "#222", order: 1 },
];
const node = (overrides: Partial<UniverseNode> = {}): UniverseNode => ({
  id: "n1", title: "Node", summary: "", content: "", type: "concept", tags: [],
  galaxies: [{ id: "g1", weight: 0.3 }, { id: "g2", weight: 0.9 }],
  position: { x: 50, y: 50 }, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...overrides,
});
const relation = (overrides: Partial<UniverseRelation> = {}): UniverseRelation => ({
  id: "r1", source: "n1", target: "n2", relationType: "related_to", strength: 0.5,
  createdAt: "2026-01-01", ...overrides,
});

test("highest membership weight chooses the primary galaxy", () => {
  assert.equal(getPrimaryGalaxy(node(), galaxies)?.id, "g2");
  assert.equal(getPrimaryGalaxy(node({ galaxies: [{ id: "missing", weight: 2 }] }), galaxies), null);
});

test("presentation sorting never mutates weighted memberships", () => {
  const memberships = node().galaxies;
  const sorted = sortMembershipsByVisualPriority(memberships, galaxies);
  assert.deepEqual(sorted.map((membership) => membership.id), ["g2", "g1"]);
  assert.deepEqual(memberships.map((membership) => membership.id), ["g1", "g2"]);
});

test("importance changes planet size within a restrained range", () => {
  const normal = getPlanetRadius("normal");
  assert.ok(getPlanetRadius("anchor") > getPlanetRadius("major"));
  assert.ok(getPlanetRadius("major") > normal);
  assert.ok(getPlanetRadius("anchor") < normal * 2);
});

test("higher importance retains labels at lower zoom", () => {
  assert.equal(derivePlanetPresentation(node({ importance: "anchor" }), 0.45).showTitle, true);
  assert.equal(derivePlanetPresentation(node({ importance: "normal" }), 0.45).showTitle, false);
});

test("galaxy focus fades but does not hide unrelated nodes", () => {
  const result = deriveGalaxyFocus(node({ id: "n1" }), "g2", null);
  assert.equal(result.isFaded, false);
  const unrelated = deriveGalaxyFocus(node({ id: "n3", galaxies: [{ id: "g1", weight: 1 }] }), "g2", null);
  assert.equal(unrelated.isFaded, true);
  assert.ok(unrelated.opacity > 0);
});

test("selection overrides galaxy-focus fading", () => {
  const result = deriveGalaxyFocus(node({ id: "n3", galaxies: [{ id: "g1", weight: 1 }] }), "g2", "n3");
  assert.equal(result.isSelected, true);
  assert.equal(result.isFaded, false);
  assert.equal(result.opacity, 1);
});

test("selected node brightens only direct relations and neighbors", () => {
  const relations = [relation(), relation({ id: "r2", source: "n3", target: "n4" })];
  const neighbors = getDirectNeighborIds("n1", relations);
  assert.deepEqual([...neighbors], ["n2"]);
  assert.equal(deriveGalaxyFocus(node({ id: "n2" }), null, "n1", new Set(["n2"])).isNeighbor, true);
  assert.equal(deriveGalaxyFocus(node({ id: "n4" }), null, "n1", new Set(["n2"])).isNeighbor, false);
  assert.equal(deriveRelationPresentation(relations[0]!, "n1").isEmphasized, true);
  assert.equal(deriveRelationPresentation(relations[1]!, "n1").isEmphasized, false);
  assert.ok(deriveRelationPresentation(relations[0]!, "n1").opacity > deriveRelationPresentation(relations[1]!, "n1").opacity);
  assert.equal(relationTypeLabel("supports"), "支持");
});

test("a selection fades ordinary planets even when no galaxy is active", () => {
  const selected = deriveGalaxyFocus(node({ id: "n1" }), null, "n1");
  const ordinary = deriveGalaxyFocus(node({ id: "n3" }), null, "n1");
  const neighbor = deriveGalaxyFocus(node({ id: "n2" }), null, "n1", new Set(["n2"]));
  assert.equal(selected.opacity, 1);
  assert.equal(neighbor.opacity, 1);
  assert.equal(ordinary.isFaded, true);
  assert.equal(ordinary.opacity, 0.28);
});

test("relation strength changes only bounded line weight/opacity", () => {
  const weak = deriveRelationPresentation(relation({ strength: 0 }), null);
  const strong = deriveRelationPresentation(relation({ strength: 100 }), null);
  assert.ok(weak.width >= 1 && strong.width <= 4);
  assert.ok(weak.opacity >= 0.18 && strong.opacity <= 0.8);
  assert.ok(strong.width > weak.width);
  assert.ok(strong.opacity > weak.opacity);
});
