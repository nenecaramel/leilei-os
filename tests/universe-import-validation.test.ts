import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStandaloneUniverseJson,
  UniverseImportValidationError,
  verifyUniverseImportReadback,
} from "../web/src/pages/universe/universe-import";

const standalone = {
  schemaVersion: 2,
  meta: {
    name: "Universe",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    exportedAt: "2026-08-15T00:00:00.000Z",
  },
  galaxies: [
    { id: "g-a", title: "A", description: "", color: "#fff", order: 0 },
    { id: "g-b", title: "B", description: "", color: "#ddd", order: 1 },
  ],
  nodes: [{
    id: "n-a",
    title: "Node",
    summary: "summary",
    content: "content",
    type: "concept",
    tags: ["tag"],
    galaxies: [{ id: "g-a", weight: 1 }, { id: "g-b", weight: 0.2718281828459 }],
    position: { x: 12.5, y: 44.25 },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    importance: "anchor",
    migration: { source: "mind-universe", migratedAt: "2026-08-02T00:00:00.000Z" },
  }],
  edges: [{
    id: "e-a",
    source: "n-a",
    target: "n-a",
    relationType: "related_to",
    strength: 0.625,
    createdAt: "2026-08-02T00:00:00.000Z",
  }],
  revisions: [{
    id: "r-a",
    nodeId: "n-a",
    createdAt: "2026-08-02T01:00:00.000Z",
    reason: "test",
    snapshot: {
      title: "Old",
      summary: "summary",
      content: "content",
      type: "concept",
      tags: ["tag"],
      galaxies: [{ id: "g-a", weight: 0.123456789 }],
    },
  }],
};

function parse(value: unknown) {
  return parseStandaloneUniverseJson(JSON.stringify(value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertInvalid(value: unknown): void {
  assert.throws(
    () => parse(value),
    (error: unknown) => error instanceof UniverseImportValidationError && error.code === "INVALID_UNIVERSE_IMPORT",
  );
}

test("parses standalone edges into canonical weighted relations", () => {
  const preview = parse(standalone);
  assert.equal(preview.snapshot.schemaVersion, 2);
  assert.equal("edges" in preview.snapshot, false);
  assert.deepEqual(preview.snapshot.relations, standalone.edges);
  assert.deepEqual(preview.snapshot.nodes[0]?.galaxies, standalone.nodes[0]?.galaxies);
  assert.deepEqual(preview.snapshot.revisions[0]?.snapshot.galaxies, standalone.revisions[0]?.snapshot.galaxies);
  assert.deepEqual(preview.snapshot.meta, {
    name: standalone.meta.name,
    createdAt: standalone.meta.createdAt,
    updatedAt: standalone.meta.updatedAt,
  });
  assert.deepEqual(preview.counts, { galaxies: 2, nodes: 1, relations: 1, revisions: 1 });
});

test("rejects malformed standalone import payloads", () => {
  assert.throws(
    () => parseStandaloneUniverseJson("not json"),
    (error: unknown) => error instanceof UniverseImportValidationError,
  );
  for (const value of [
    { ...standalone, schemaVersion: 1 },
    { ...standalone, edges: undefined },
    { ...standalone, edges: "nope" },
    { ...standalone, backups: [] },
    { ...standalone, galaxies: [{ ...standalone.galaxies[0], id: "g-a" }, { ...standalone.galaxies[1], id: "g-a" }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], id: "n-a" }, { ...standalone.nodes[0], id: "n-a" }] },
    { ...standalone, edges: [{ ...standalone.edges[0], id: "e-a" }, { ...standalone.edges[0], id: "e-a" }] },
    { ...standalone, revisions: [{ ...standalone.revisions[0], id: "r-a" }, { ...standalone.revisions[0], id: "r-a" }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], galaxies: ["g-a"] }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], galaxies: [{ id: "g-a", weight: Number.NaN }] }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], galaxies: [{ id: "g-a", weight: 1 }, { id: "g-a", weight: 1 }] }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], galaxies: [{ id: "missing", weight: 1 }] }] },
    { ...standalone, edges: [{ ...standalone.edges[0], source: "missing" }] },
    { ...standalone, edges: [{ ...standalone.edges[0], relationType: "unknown" }] },
    { ...standalone, edges: [standalone.edges[0], { ...standalone.edges[0], id: "e-b", source: "n-a", target: "n-a", relationType: "related_to" }] },
    { ...standalone, meta: { ...standalone.meta, updatedAt: "not-a-date" } },
    { ...standalone, nodes: [{ ...standalone.nodes[0], migration: { source: "unknown", migratedAt: standalone.meta.updatedAt } }] },
    { ...standalone, nodes: [{ ...standalone.nodes[0], migration: { source: "mind-universe", migratedAt: "not-a-date" } }] },
  ]) {
    assertInvalid(value);
  }
});

test("readback comparison ignores top-level entity ordering but preserves canonical content", () => {
  const expected = parse(standalone).snapshot;
  const reordered = {
    ...expected,
    galaxies: [...expected.galaxies].reverse(),
    nodes: [...expected.nodes].reverse(),
    relations: [...expected.relations].reverse(),
    revisions: [...expected.revisions].reverse(),
  };
  assert.doesNotThrow(() => verifyUniverseImportReadback(expected, reordered));
  assert.throws(() => verifyUniverseImportReadback(expected, {
    ...reordered,
    nodes: reordered.nodes.map((node) => node.id === "n-a"
      ? { ...node, galaxies: [{ id: "g-a", weight: 0.5 }, { id: "g-b", weight: 0.2718281828459 }] }
      : node),
  }), (error: unknown) => error instanceof UniverseImportValidationError);
});
