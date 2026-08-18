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

test("parseImportPackage accepts diary tags at the current canonical limit", () => {
  const longTag = "d".repeat(50);
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
    { ...base, data: { memory: [{ ...memory, content: "x".repeat(4_001) }] } },
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
