import assert from "node:assert/strict";
import test from "node:test";
import {
  UniverseValidationError,
  validateUniverseSnapshot,
  validateUniverseRelation,
  validateUniverseNode,
  normalizeNodeCreate,
  normalizeRelationCreate,
} from "../src/domains/universe/universe-validation.js";

const timestamp = "2026-08-14T00:00:00.000Z";

const node = {
  id: "node-1",
  title: "Unknown type remains valid",
  summary: "summary",
  content: "content",
  type: "legacy-type",
  tags: ["one"],
  galaxies: [{ id: "galaxy-1", weight: 1 }],
  position: { x: 1, y: -2 },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const galaxy = {
  id: "galaxy-1",
  title: "Galaxy",
  description: "Description",
  color: "#ffffff",
  order: 0,
};

test("validates schemaVersion 2 and allows compatible unknown node types", () => {
  const snapshot = validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [node],
    relations: [],
    revisions: [],
  });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.nodes[0]?.type, "legacy-type");
});

test("rejects invalid position and relation endpoint references", () => {
  assert.throws(
    () => validateUniverseNode({ ...node, position: { x: Number.NaN, y: 0 } }),
    (error: unknown) => error instanceof UniverseValidationError && error.code === "INVALID_UNIVERSE",
  );
  assert.throws(
    () => validateUniverseSnapshot({
      schemaVersion: 2,
      meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
      galaxies: [galaxy],
      nodes: [node],
      relations: [{
        id: "edge-1", source: "missing", target: "node-1", relationType: "related_to", strength: 0.5, createdAt: timestamp,
      }],
      revisions: [],
    }),
    (error: unknown) => error instanceof UniverseValidationError && error.code === "INVALID_UNIVERSE",
  );
});

test("allows reverse, different-type, and self relations but rejects directional duplicates", () => {
  const base = {
    id: "edge-1",
    source: "node-1",
    target: "node-2",
    relationType: "related_to" as const,
    strength: 0.5,
    createdAt: timestamp,
  };
  validateUniverseRelation(base);
  validateUniverseRelation({ ...base, id: "edge-2", source: "node-2", target: "node-1" });
  validateUniverseRelation({ ...base, id: "edge-3", relationType: "supports" });
  validateUniverseRelation({ ...base, id: "edge-4", source: "node-1", target: "node-1" });
});

test("create normalization generates string IDs and preserves only documented defaults", () => {
  const created = normalizeNodeCreate({
    title: "n", summary: "s", content: "c", type: "future-type", tags: [], galaxies: [], position: { x: 0, y: 0 },
  }, timestamp);
  assert.match(created.id, /^node-[0-9a-f-]{36}$/u);
  assert.equal(created.createdAt, timestamp);
  assert.equal(created.updatedAt, timestamp);
  const relation = normalizeRelationCreate({ source: created.id, target: created.id, relationType: "raises", strength: 99 }, timestamp);
  assert.match(relation.id, /^edge-[0-9a-f-]{36}$/u);
  assert.equal(relation.createdAt, timestamp);
});

test("relation create normalization preserves a supplied createdAt", () => {
  const suppliedCreatedAt = "2025-01-02T03:04:05.000Z";
  const relation = normalizeRelationCreate({
    source: "node-1",
    target: "node-1",
    relationType: "raises",
    strength: 0.5,
    createdAt: suppliedCreatedAt,
  }, timestamp);
  assert.equal(relation.createdAt, suppliedCreatedAt);
});

test("accepts weighted memberships without clamping finite weights", () => {
  const weighted = validateUniverseNode({ ...node, galaxies: [{ id: "galaxy-1", weight: 2.75 }] });
  assert.deepEqual(weighted.galaxies, [{ id: "galaxy-1", weight: 2.75 }]);
});

test("rejects legacy string memberships and non-finite weights", () => {
  assert.throws(() => validateUniverseNode({ ...node, galaxies: ["galaxy-1"] }));
  assert.throws(() => validateUniverseNode({ ...node, galaxies: [{ id: "galaxy-1", weight: Number.NaN }] }));
  assert.throws(() => validateUniverseNode({ ...node, galaxies: [{ id: "galaxy-1", weight: Number.POSITIVE_INFINITY }] }));
});

test("rejects duplicate memberships and unknown galaxy references", () => {
  assert.throws(() => validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [{ ...node, galaxies: [{ id: "galaxy-1", weight: 1 }, { id: "galaxy-1", weight: 0.5 }] }],
    relations: [],
    revisions: [],
  }));
  assert.throws(() => validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [{ ...node, galaxies: [{ id: "missing", weight: 1 }] }],
    relations: [],
    revisions: [],
  }));
});

test("revision snapshots preserve weighted memberships", () => {
  const snapshot = validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [node],
    relations: [],
    revisions: [{
      id: "revision-1",
      nodeId: "node-1",
      createdAt: timestamp,
      reason: "test",
      snapshot: {
        title: "Unknown type remains valid",
        summary: "summary",
        content: "content",
        type: "legacy-type",
        tags: ["one"],
        galaxies: [{ id: "galaxy-1", weight: 0.25 }],
      },
    }],
  });
  assert.deepEqual(snapshot.revisions[0]?.snapshot.galaxies, [{ id: "galaxy-1", weight: 0.25 }]);
});

test("revision snapshots preserve optional importance and migration metadata", () => {
  const snapshot = validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [node],
    relations: [],
    revisions: [{
      id: "revision-meta",
      nodeId: "node-1",
      createdAt: timestamp,
      reason: "metadata",
      snapshot: {
        title: "Unknown type remains valid",
        summary: "summary",
        content: "content",
        type: "legacy-type",
        tags: ["one"],
        galaxies: [{ id: "galaxy-1", weight: 0.25 }],
        importance: "major",
        migration: { source: "mind-universe", migratedAt: timestamp },
      },
    }],
  });
  assert.equal(snapshot.revisions[0]?.snapshot.importance, "major");
  assert.deepEqual(snapshot.revisions[0]?.snapshot.migration, { source: "mind-universe", migratedAt: timestamp });
});
