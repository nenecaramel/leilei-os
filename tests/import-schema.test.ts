import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import {
  ImportValidationError,
  parseImportPackage,
} from "../src/domains/import/import-schema.js";

const OWNER = createOwnerFingerprint("user-import-test");

function validDocument(data: Record<string, unknown> = { memory: [] }) {
  return {
    schema_version: 2,
    owner_fingerprint: OWNER,
    exported_at: "2026-08-14T00:00:00.000Z",
    data,
  };
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

test("parseImportPackage accepts v2 and binds the exact package bytes", () => {
  const raw = bytes(validDocument());
  const parsed = parseImportPackage(raw);
  assert.deepEqual(parsed.document.data, { memory: [] });
  assert.match(parsed.package_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(parsed.raw_bytes, raw.length);
});

test("parseImportPackage accepts C for every author-bearing record and rejects Claude", () => {
  const cMemory = {
    id: "00000000-0000-4000-8000-000000000031", category: "profile", key: "C memory", content: "C memory content",
    tags: [], visibility: "assistant", source: "web", author: "C", status: "active", sort_order: 0,
    created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z",
  };
  const cDiary = {
    id: "00000000-0000-4000-8000-000000000032", title: "C diary", content: "C diary content", date: "2026-08-14",
    tags: [], mood: null, source: "chatgpt_mcp", author: "C", status: "active",
    created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z",
  };
  const cTask = {
    id: "00000000-0000-4000-8000-000000000033", title: "C task", description: "C task description", status: "pending",
    resume_status: null, lifecycle_status: "active", author: "C", priority: "normal", due_time: null, timezone: "Asia/Shanghai", tags: [],
    created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z", completed_at: null,
  };
  const cTodo = {
    date: "2026-08-14", author: "C", revision: 0,
    created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z", entries: [],
  };
  const document = validDocument({ memory: [cMemory], diary: [cDiary], task: [cTask], todo: [cTodo] });
  const parsed = parseImportPackage(bytes(document));
  assert.deepEqual(parsed.document.data, document.data);

  assert.throws(
    () => parseImportPackage(bytes(validDocument({ memory: [{ ...cMemory, author: "Claude" }] }))),
    (error: unknown) => error instanceof ImportValidationError && error.code === "INVALID_IMPORT_FILE",
  );
});
test("parseImportPackage rejects v1 with an explicit unsupported-version error", () => {
  assert.throws(
    () => parseImportPackage(bytes({ schema_version: 1, exported_at: "2026-08-14T00:00:00.000Z", data: { memory: [] } })),
    (error: unknown) => error instanceof ImportValidationError && error.code === "UNSUPPORTED_EXPORT_VERSION",
  );
});

test("parseImportPackage rejects unknown fields, malformed owner fingerprints, and no modules", () => {
  for (const value of [
    { ...validDocument(), extra: true },
    { ...validDocument(), owner_fingerprint: "not-a-fingerprint" },
    validDocument({}),
  ]) {
    assert.throws(
      () => parseImportPackage(bytes(value)),
      (error: unknown) => error instanceof ImportValidationError && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage validates exported business invariants without coercion", () => {
  const invalidMemory = {
    id: "not-a-uuid",
    category: "profile",
    key: "name",
    content: "Leilei",
    tags: [],
    visibility: "assistant",
    source: "web",
    author: null,
    status: "active",
    sort_order: 0,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  };
  assert.throws(
    () => parseImportPackage(bytes(validDocument({ memory: [invalidMemory] }))),
    (error: unknown) => error instanceof ImportValidationError && error.code === "INVALID_IMPORT_FILE",
  );
});

test("parseImportPackage accepts the historical 80-character Diary tag export", () => {
  const longTag = "d".repeat(80);
  const diary = {
    id: "00000000-0000-4000-8000-000000000012",
    title: "Long tag diary",
    content: "A valid exported diary entry",
    date: "2026-08-14",
    tags: [longTag],
    mood: null,
    source: "chatgpt_mcp",
    author: "L",
    status: "active",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  };
  const parsed = parseImportPackage(bytes(validDocument({ diary: [diary] })));
  assert.equal(parsed.document.data.diary?.[0]?.tags[0], longTag);
});

test("parseImportPackage accepts values that are valid in storage but wider than live-write limits", () => {
  const diary = {
    id: "00000000-0000-4000-8000-000000000021",
    title: "Historical diary",
    content: "x".repeat(20_001),
    date: "2026-08-14",
    tags: ["d".repeat(80)],
    mood: null,
    source: "chatgpt_mcp",
    author: "L",
    status: "active",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  };
  const task = {
    id: "00000000-0000-4000-8000-000000000022",
    title: "Historical task",
    description: "x".repeat(5_001),
    status: "pending",
    resume_status: null,
    lifecycle_status: "active",
    author: null,
    priority: "normal",
    due_time: null,
    timezone: "Asia/Shanghai",
    tags: [],
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    completed_at: null,
  };
  const todo = {
    date: "2026-08-14",
    author: "L",
    revision: 0,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    entries: [{ id: "i".repeat(129), kind: "record", text: "x".repeat(4_001) }],
  };

  const parsed = parseImportPackage(bytes(validDocument({ diary: [diary], task: [task], todo: [todo] })));
  assert.equal(parsed.document.data.diary?.[0]?.tags[0]?.length, 80);
  assert.equal(parsed.document.data.diary?.[0]?.content.length, 20_001);
  assert.equal(parsed.document.data.task?.[0]?.description.length, 5_001);
  assert.equal(parsed.document.data.todo?.[0]?.entries[0]?.id.length, 129);
  assert.equal(parsed.document.data.todo?.[0]?.entries[0]?.text.length, 4_001);
});

test("parseImportPackage accepts the canonical Shared Paper export shape", () => {
  const sharedPaper = {
    id: "00000000-0000-4000-8000-000000000041",
    title: "Shared import",
    content: "Canonical shared paper content",
    revision: 3,
    created_by: "L",
    updated_by: "C",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-15T00:00:00.000Z",
    archived_at: "2026-08-16T00:00:00.000Z",
  };
  const document = validDocument({ shared_paper: [sharedPaper] });
  const parsed = parseImportPackage(bytes(document));
  assert.deepEqual(parsed.document.data.shared_paper, [sharedPaper]);
});

test("parseImportPackage strictly validates Shared Paper fields", () => {
  const sharedPaper = {
    id: "00000000-0000-4000-8000-000000000042",
    title: "Shared import",
    content: "Canonical shared paper content",
    revision: 1,
    created_by: "L",
    updated_by: "L",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    archived_at: null,
  };
  for (const invalid of [
    { ...sharedPaper, revision: 0 },
    { ...sharedPaper, title: "   " },
    { ...sharedPaper, created_by: "Claude" },
    { ...sharedPaper, archived_at: "not-a-timestamp" },
    { ...sharedPaper, unexpected: true },
  ]) {
    assert.throws(
      () => parseImportPackage(bytes(validDocument({ shared_paper: [invalid] }))),
      (error: unknown) => error instanceof ImportValidationError && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage applies Shared Paper text limits in Unicode code points", () => {
  const sharedPaper = {
    id: "00000000-0000-4000-8000-000000000043",
    title: "😀".repeat(200),
    content: "😀".repeat(100_000),
    revision: 1,
    created_by: "L",
    updated_by: "C",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    archived_at: null,
  };
  assert.doesNotThrow(() => parseImportPackage(bytes(validDocument({ shared_paper: [sharedPaper] }))));
  assert.throws(() => parseImportPackage(bytes(validDocument({ shared_paper: [{ ...sharedPaper, title: "😀".repeat(201) }] }))), ImportValidationError);
  assert.throws(() => parseImportPackage(bytes(validDocument({ shared_paper: [{ ...sharedPaper, content: "😀".repeat(100_001) }] }))), ImportValidationError);
});

test("parseImportPackage enforces canonical record and collection limits before planning", () => {
  const memory = {
    id: "00000000-0000-4000-8000-000000000101",
    category: "profile",
    key: "memory",
    content: "content",
    tags: [],
    visibility: "assistant",
    source: "web",
    author: "L",
    status: "active",
    sort_order: 0,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  };
  const base = validDocument({ memory: [memory] });
  assert.doesNotThrow(() => parseImportPackage(bytes(base)));
  for (const value of [
    { ...base, data: { memory: [{ ...memory, key: "k".repeat(101) }] } },
    { ...base, data: { memory: Array.from({ length: 10_001 }, (_, index) => ({ ...memory, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })) } },
    { ...base, data: { todo: [{ date: "2026-08-14", author: "L", revision: 0, created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z", entries: Array.from({ length: 201 }, (_, index) => ({ id: String(index), kind: "record", text: "x" })) }] } },
    { ...base, audit: { lifecycle: Array.from({ length: 50_001 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, resource_type: "memory", resource_id: "00000000-0000-4000-8000-000000000101", action: "create", actor_type: "user", channel: "web", created_at: "2026-08-14T00:00:00.000Z" })), tool_activity: [] } },
  ]) {
    assert.throws(() => parseImportPackage(bytes(value)), (error: unknown) => {
      if (!(error instanceof ImportValidationError)) return false;
      return error.code === "INVALID_IMPORT_FILE" || error.code === "IMPORT_TOO_LARGE";
    });
  }
});
