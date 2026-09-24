import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerFingerprint } from "../src/domains/export/owner-fingerprint.js";
import {
  ImportValidationError,
  parseImportPackage,
} from "../src/domains/import/import-schema.js";

const OWNER = createOwnerFingerprint("user-import-test");

function validDocument(
  data: Record<string, unknown> = { diary: [] },
) {
  return {
    schema_version: 2,
    owner_fingerprint: OWNER,
    exported_at: "2026-08-14T00:00:00.000Z",
    data,
  };
}

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(value),
  );
}

const cDiary = {
  id: "00000000-0000-4000-8000-000000000032",
  title: "C diary",
  content: "C diary content",
  date: "2026-08-14",
  tags: [],
  mood: null,
  source: "chatgpt_mcp",
  author: "C",
  status: "active",
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

const cTodo = {
  date: "2026-08-14",
  author: "C",
  revision: 0,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
  entries: [],
};

test("parseImportPackage accepts v2 active-module packages and binds exact bytes", () => {
  const raw = bytes(
    validDocument({
      diary: [cDiary],
      todo: [cTodo],
    }),
  );
  const parsed = parseImportPackage(raw);

  assert.deepEqual(parsed.document.data, {
    diary: [cDiary],
    todo: [cTodo],
  });
  assert.match(
    parsed.package_sha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(parsed.raw_bytes, raw.length);
});

test("parseImportPackage accepts C for active author-bearing records and rejects Claude", () => {
  assert.doesNotThrow(() =>
    parseImportPackage(
      bytes(
        validDocument({
          diary: [cDiary],
          todo: [cTodo],
        }),
      ),
    ),
  );

  for (const data of [
    {
      diary: [{
        ...cDiary,
        author: "Claude",
      }],
    },
    {
      todo: [{
        ...cTodo,
        author: "Claude",
      }],
    },
  ]) {
    assert.throws(
      () =>
        parseImportPackage(
          bytes(validDocument(data)),
        ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage rejects retired module payloads", () => {
  for (const data of [
    { memory: [] },
    { task: [] },
    { shared_paper: [] },
    { diary: [], memory: [] },
    { todo: [], task: [] },
  ]) {
    assert.throws(
      () =>
        parseImportPackage(
          bytes(validDocument(data)),
        ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage rejects v1 with an explicit unsupported-version error", () => {
  assert.throws(
    () =>
      parseImportPackage(
        bytes({
          schema_version: 1,
          exported_at:
            "2026-08-14T00:00:00.000Z",
          data: { diary: [] },
        }),
      ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code === "UNSUPPORTED_EXPORT_VERSION",
  );
});

test("parseImportPackage rejects unknown fields, malformed owner fingerprints, and no modules", () => {
  for (const value of [
    { ...validDocument(), extra: true },
    {
      ...validDocument(),
      owner_fingerprint: "not-a-fingerprint",
    },
    validDocument({}),
  ]) {
    assert.throws(
      () =>
        parseImportPackage(bytes(value)),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage accepts historical Diary and Todo storage widths", () => {
  const longTag = "d".repeat(80);
  const diary = {
    ...cDiary,
    content: "x".repeat(20_001),
    tags: [longTag],
  };
  const todo = {
    ...cTodo,
    entries: [{
      id: "i".repeat(129),
      kind: "record",
      text: "x".repeat(4_001),
    }],
  };

  const parsed = parseImportPackage(
    bytes(
      validDocument({
        diary: [diary],
        todo: [todo],
      }),
    ),
  );

  assert.equal(
    parsed.document.data.diary?.[0]?.tags[0],
    longTag,
  );
  assert.equal(
    parsed.document.data.diary?.[0]?.content.length,
    20_001,
  );
  assert.equal(
    parsed.document.data.todo?.[0]?.entries[0]?.id.length,
    129,
  );
  assert.equal(
    parsed.document.data.todo?.[0]?.entries[0]?.text.length,
    4_001,
  );
});

test("parseImportPackage enforces active-module collection limits before planning", () => {
  const base = validDocument({
    diary: [cDiary],
  });
  assert.doesNotThrow(() =>
    parseImportPackage(bytes(base)),
  );

  for (const value of [
    {
      ...base,
      data: {
        diary: Array.from(
          { length: 10_001 },
          (_, index) => ({
            ...cDiary,
            id:
              `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          }),
        ),
      },
    },
    validDocument({
      todo: [{
        ...cTodo,
        entries: Array.from(
          { length: 201 },
          (_, index) => ({
            id: String(index),
            kind: "record",
            text: "x",
          }),
        ),
      }],
    }),
  ]) {
    assert.throws(
      () =>
        parseImportPackage(bytes(value)),
      (error: unknown) => {
        if (!(error instanceof ImportValidationError)) {
          return false;
        }
        return (
          error.code === "INVALID_IMPORT_FILE"
          || error.code === "IMPORT_TOO_LARGE"
        );
      },
    );
  }
});
