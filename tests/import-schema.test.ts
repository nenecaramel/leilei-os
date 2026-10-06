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

function validV3Document(
  data: Record<string, unknown>,
) {
  return {
    schema_version: 3,
    owner_fingerprint: OWNER,
    exported_at: "2026-08-14T00:00:00.000Z",
    data,
  };
}

function validV4Document(
  data: Record<string, unknown>,
) {
  return {
    schema_version: 4,
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

test("parseImportPackage enforces Mind continuity database string constraints", () => {
  const valid = {
    drive_satisfaction_events: [{
      id: "00000000-0000-4000-8000-000000000081",
      subject_id: "claude",
      drive_state_id:
        "00000000-0000-4000-8000-000000000082",
      conversation_id:
        "00000000-0000-4000-8000-000000000083",
      evidence_message_id:
        "00000000-0000-4000-8000-000000000084",
      evidence_block_id: null,
      evidence_kind: "assistant_message",
      amount: 0.5,
      idempotency_key: "drive-satisfy-000001",
      created_at: "2026-08-14T00:00:00.000Z",
    }],
    curiosity_resolution_events: [],
    distillation_watermarks: [{
      subject_id: "claude",
      conversation_id:
        "00000000-0000-4000-8000-000000000083",
      last_source_message_id:
        "00000000-0000-4000-8000-000000000084",
      process_version: "distill-v1",
      updated_at: "2026-08-14T00:00:00.000Z",
    }],
    semantic_grouping_results: [],
  };

  assert.doesNotThrow(() =>
    parseImportPackage(
      bytes(validV3Document({
        mind_continuity: valid,
      })),
    ),
  );

  for (const candidate of [
    {
      ...valid,
      drive_satisfaction_events: [{
        ...valid.drive_satisfaction_events[0],
        idempotency_key: "contains space 0001",
      }],
    },
    {
      ...valid,
      drive_satisfaction_events: [{
        ...valid.drive_satisfaction_events[0],
        subject_id: "   ",
      }],
    },
    {
      ...valid,
      distillation_watermarks: [{
        ...valid.distillation_watermarks[0],
        process_version: "   ",
      }],
    },
  ]) {
    assert.throws(
      () =>
        parseImportPackage(
          bytes(validV3Document({
            mind_continuity: candidate,
          })),
        ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage validates conversation continuation checkpoints", () => {
  const checkpoint = {
    id: "00000000-0000-4000-8000-000000000091",
    conversation_id:
      "00000000-0000-4000-8000-000000000092",
    canonical_message_id:
      "00000000-0000-4000-8000-000000000093",
    provider: "claude_code",
    provider_session_id: "session-restore-1",
    runtime_metadata: { compacted: false },
    provider_checkpoint_id: "checkpoint-restore-1",
    created_at: "2026-08-14T00:00:00.000Z",
  };
  const conversation = {
    conversations: [{
      id: checkpoint.conversation_id,
      title: "Conversation",
      lifecycle_status: "active",
      current_head_message_id:
        checkpoint.canonical_message_id,
      default_model: "claude-sonnet",
      provider_metadata: {},
      created_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
      archived_at: null,
    }],
    messages: [{
      id: checkpoint.canonical_message_id,
      conversation_id: checkpoint.conversation_id,
      parent_message_id: null,
      role: "assistant",
      status: "completed",
      raw_role: null,
      model: "claude-sonnet",
      is_current_path: true,
      current_path_index: 0,
      turn_index: 0,
      is_primary: true,
      display_text: "hi",
      created_at: "2026-08-14T00:00:00.000Z",
      completed_at: "2026-08-14T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
    }],
    content_blocks: [],
    attachments: [],
    provider_checkpoints: [checkpoint],
  };

  assert.doesNotThrow(() =>
    parseImportPackage(
      bytes(validV3Document({
        conversations: conversation,
      })),
    ),
  );

  for (const invalid of [
    { ...checkpoint, provider: "other" },
    { ...checkpoint, provider_session_id: "   " },
    { ...checkpoint, provider_checkpoint_id: "   " },
  ]) {
    assert.throws(
      () =>
        parseImportPackage(
          bytes(validV3Document({
            conversations: {
              ...conversation,
              provider_checkpoints: [invalid],
            },
          })),
        ),
      (error: unknown) =>
        error instanceof ImportValidationError
        && error.code === "INVALID_IMPORT_FILE",
    );
  }
});

test("parseImportPackage rejects retired Workspace backups explicitly", () => {
  const workspaceId =
    "00000000-0000-4000-8000-000000000201";
  const resourceId =
    "00000000-0000-4000-8000-000000000202";
  const raw = bytes(validV4Document({
    workspaces: {
      items: [{
        id: workspaceId,
        name: "LeileiOS",
        description: "Portable Workspace",
        version: 1,
        created_at: "2026-08-14T00:00:00.000Z",
        updated_at: "2026-08-14T00:00:00.000Z",
      }],
      resources: [{
        id: resourceId,
        workspace_id: workspaceId,
        kind: "file",
        key: "README.md",
        title: "Readme",
        content: "hello",
        metadata: {},
        version: 1,
        created_at: "2026-08-14T00:00:00.000Z",
        updated_at: "2026-08-14T00:00:00.000Z",
      }],
      conversations: [],
    },
  }));
  assert.throws(() => parseImportPackage(raw), /retired Product Workspace data/);
});

test("v4 rejects legacy projects and v3 rejects future workspaces", () => {
  const emptyV3Projects = {
    workspaces: [],
    projects: [],
    resources: [],
    conversations: [],
  };
  const emptyV4Workspaces = {
    items: [],
    resources: [],
    conversations: [],
  };
  assert.throws(
    () => parseImportPackage(
      bytes(validV4Document({ projects: emptyV3Projects })),
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code === "INVALID_IMPORT_FILE",
  );
  assert.throws(
    () => parseImportPackage(
      bytes(validV3Document({ workspaces: emptyV4Workspaces })),
    ),
    (error: unknown) =>
      error instanceof ImportValidationError
      && error.code === "INVALID_IMPORT_FILE",
  );
});
