import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import type {
  ExportDiaryRecord,
  ExportTodoPaper,
} from "../src/domains/export/export-types.js";
import {
  buildImportPlan,
  type ImportCurrentState,
} from "../src/domains/import/import-planner.js";
import {
  ImportValidationError,
  parseImportPackage,
} from "../src/domains/import/import-schema.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const NOW = "2026-08-14T00:00:00.000Z";

const diary: ExportDiaryRecord = {
  id: "00000000-0000-4000-8000-000000000031",
  title: "Diary",
  content: "Canonical diary content",
  date: "2026-08-13",
  tags: ["active"],
  mood: null,
  source: "chatgpt_mcp",
  author: "C",
  status: "active",
  created_at: NOW,
  updated_at: NOW,
};

const todo: ExportTodoPaper = {
  date: "2026-08-13",
  author: "C",
  revision: 2,
  created_at: NOW,
  updated_at: NOW,
  entries: [
    { id: "entry-1", kind: "pending", text: "Todo" },
  ],
};

const emptyState: ImportCurrentState = {
  diary: [],
  todo: [],
};

function parsed(data: Record<string, unknown>) {
  return parseImportPackage(
    new TextEncoder().encode(
      JSON.stringify({
        schema_version: 2,
        owner_fingerprint:
          createOwnerFingerprint(USER_ID),
        exported_at: NOW,
        data,
      }),
    ),
  );
}

test("planner creates active Diary and Todo records", () => {
  const plan = buildImportPlan(
    parsed({ diary: [diary], todo: [todo] }),
    USER_ID,
    emptyState,
  );

  assert.deepEqual(plan.summary.diary, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.deepEqual(plan.summary.todo, {
    create: 1,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
  });
  assert.equal(plan.can_execute, true);
});

test("planner classifies duplicates and conflicts for active modules", () => {
  const duplicate = buildImportPlan(
    parsed({ diary: [diary], todo: [todo] }),
    USER_ID,
    { diary: [diary], todo: [todo] },
  );
  assert.equal(duplicate.summary.diary.duplicate, 1);
  assert.equal(duplicate.summary.todo.duplicate, 1);
  assert.equal(duplicate.can_execute, false);

  const conflict = buildImportPlan(
    parsed({
      diary: [{ ...diary, content: "changed" }],
    }),
    USER_ID,
    { diary: [diary], todo: [] },
  );
  assert.equal(conflict.summary.diary.conflict, 1);
  assert.equal(conflict.can_execute, false);
});

test("planner rejects duplicate logical keys inside one package", () => {
  const plan = buildImportPlan(
    parsed({ diary: [diary, diary] }),
    USER_ID,
    emptyState,
  );

  assert.equal(plan.summary.diary.invalid, 2);
  assert.equal(plan.can_execute, false);
});

test("planner protects against a Diary id owned by another user", () => {
  const plan = buildImportPlan(
    parsed({ diary: [diary] }),
    USER_ID,
    {
      diary: [],
      todo: [],
      foreign_diary_ids: new Set([diary.id]),
    },
  );

  assert.equal(plan.summary.diary.conflict, 1);
  assert.equal(plan.can_execute, false);
});

test("retired module payloads are rejected before planning", () => {
  for (const data of [
    { memory: [] },
    { task: [] },
    { shared_paper: [] },
  ]) {
    assert.throws(
      () => parsed(data),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("planner enforces owner binding", () => {
  assert.throws(
    () =>
      buildImportPlan(
        parsed({ diary: [diary] }),
        "00000000-0000-4000-8000-000000000100",
        emptyState,
      ),
    ImportValidationError,
  );
});
