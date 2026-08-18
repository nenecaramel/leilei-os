import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import { parseImportPackage } from "../src/domains/import/import-schema.js";
import {
  buildImportPlan,
  type ImportCurrentState,
} from "../src/domains/import/import-planner.js";

const USER_ID = "user-import-planner";
const OWNER = createOwnerFingerprint(USER_ID);
const memory = {
  id: "00000000-0000-4000-8000-000000000001",
  category: "profile" as const,
  key: "name",
  content: "Leilei",
  tags: [],
  visibility: "assistant",
  source: "web",
  author: "L" as const,
  status: "active" as const,
  sort_order: 0,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};
const document = {
  schema_version: 2 as const,
  owner_fingerprint: OWNER,
  exported_at: "2026-08-14T00:00:00.000Z",
  data: { memory: [memory] },
};

function parsed() {
  return parseImportPackage(new TextEncoder().encode(JSON.stringify(document)));
}

const emptyState: ImportCurrentState = { memory: [], diary: [], task: [], todo: [] };

test("planner classifies a new record as create and produces an executable plan", () => {
  const plan = buildImportPlan(parsed(), USER_ID, emptyState);
  assert.equal(plan.can_execute, true);
  assert.deepEqual(plan.summary.memory, { create: 1, duplicate: 0, conflict: 0, invalid: 0 });
  assert.equal(plan.items[0]?.classification, "create");
  assert.match(plan.preview_fingerprint, /^[0-9a-f]{64}$/u);
});
test("planner classifies exact replay as duplicate and never executable by itself", () => {
  const plan = buildImportPlan(parsed(), USER_ID, { ...emptyState, memory: [memory] });
  assert.equal(plan.can_execute, false);
  assert.deepEqual(plan.summary.memory, { create: 0, duplicate: 1, conflict: 0, invalid: 0 });
});

test("planner classifies same identity with changed data as conflict without overwrite", () => {
  const current = { ...memory, content: "Changed elsewhere" };
  const plan = buildImportPlan(parsed(), USER_ID, { ...emptyState, memory: [current] });
  assert.deepEqual(plan.summary.memory, { create: 0, duplicate: 0, conflict: 1, invalid: 0 });
  assert.equal(plan.can_execute, false);
});

test("planner rejects owner mismatch and package-internal duplicate identities", () => {
  assert.throws(
    () => buildImportPlan(parsed(), "another-user", emptyState),
    (error: unknown) => error instanceof Error && error.message === "IMPORT_OWNER_MISMATCH",
  );
  const duplicateDocument = { ...document, data: { memory: [memory, memory] } };
  const duplicatePlan = buildImportPlan(
    parseImportPackage(new TextEncoder().encode(JSON.stringify(duplicateDocument))),
    USER_ID,
    emptyState,
  );
  assert.equal(duplicatePlan.summary.memory.invalid, 2);
  assert.equal(duplicatePlan.can_execute, false);
});
