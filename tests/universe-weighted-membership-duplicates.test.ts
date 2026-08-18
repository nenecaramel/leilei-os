import assert from "node:assert/strict";
import test from "node:test";
import {
  UniverseValidationError,
  validateUniverseNode,
  validateUniverseSnapshot,
} from "../src/domains/universe/universe-validation.js";

const timestamp = "2026-08-15T00:00:00.000Z";
const duplicateMemberships = [
  { id: "galaxy-1", weight: 1 },
  { id: "galaxy-1", weight: 0.5 },
];

const node = {
  id: "node-1",
  title: "Node",
  summary: "summary",
  content: "content",
  type: "concept",
  tags: [],
  galaxies: duplicateMemberships,
  position: { x: 0, y: 0 },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const galaxy = {
  id: "galaxy-1",
  title: "Galaxy",
  description: "",
  color: "#fff",
  order: 0,
};

function isValidationError(error: unknown): boolean {
  return error instanceof UniverseValidationError && error.code === "INVALID_UNIVERSE";
}

test("validateUniverseNode rejects duplicate weighted membership IDs", () => {
  assert.throws(() => validateUniverseNode(node), isValidationError);
});

test("revision snapshots reject duplicate weighted membership IDs", () => {
  assert.throws(() => validateUniverseSnapshot({
    schemaVersion: 2,
    meta: { name: "Universe", createdAt: timestamp, updatedAt: timestamp },
    galaxies: [galaxy],
    nodes: [{ ...node, galaxies: [{ id: "galaxy-1", weight: 1 }] }],
    relations: [],
    revisions: [{
      id: "revision-1",
      nodeId: "node-1",
      createdAt: timestamp,
      reason: "test",
      snapshot: {
        title: "Node",
        summary: "summary",
        content: "content",
        type: "concept",
        tags: [],
        galaxies: duplicateMemberships,
      },
    }],
  }), isValidationError);
});
