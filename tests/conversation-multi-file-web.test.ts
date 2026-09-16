import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  createConversationArchiveApi,
  type ConversationImportBatchPreview,
} from "../web/src/pages/conversation-archive-api.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const SOURCE_A = "33333333-3333-4333-8333-333333333333";
const SOURCE_B = "44444444-4444-4444-8444-444444444444";

function batchPreview(): ConversationImportBatchPreview {
  return {
    batch_fingerprint: "a".repeat(64),
    files: {
      total: 2,
      unique: 2,
      duplicate: 0,
      already_executed: 0,
      pending: 2,
    },
    summary: {
      conversations: { create: 2, update: 0, unchanged: 0, stale: 0 },
      messages: { create: 4, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
    },
    warning_count: 0,
    warning_codes: {},
    exclusions: { conversations: 0, messages: 0, branch_roots: 0 },
    items: [
      {
        input_index: 1,
        import_run_id: RUN_B,
        source_id: SOURCE_B,
        provider: "claude",
        parser_version: "claude-v1",
        filename: "conversations-001.zip",
        raw_sha256: "b".repeat(64),
        raw_bytes: 200,
        status: "pending",
        duplicate_of_import_run_id: null,
        executed_run_id: null,
        preview_fingerprint: "c".repeat(64),
        summary: {
          conversations: { create: 1, update: 0, unchanged: 0, stale: 0 },
          messages: { create: 2, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
        },
        warning_count: 0,
        warning_codes: {},
        exclusions: { conversations: 0, messages: 0, branch_roots: 0 },
      },
      {
        input_index: 0,
        import_run_id: RUN_A,
        source_id: SOURCE_A,
        provider: "claude",
        parser_version: "claude-v1",
        filename: "conversations-000.zip",
        raw_sha256: "d".repeat(64),
        raw_bytes: 100,
        status: "pending",
        duplicate_of_import_run_id: null,
        executed_run_id: null,
        preview_fingerprint: "e".repeat(64),
        summary: {
          conversations: { create: 1, update: 0, unchanged: 0, stale: 0 },
          messages: { create: 2, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
        },
        warning_count: 0,
        warning_codes: {},
        exclusions: { conversations: 0, messages: 0, branch_roots: 0 },
      },
    ],
  };
}

test("Conversation Web batch Preview preserves selected run order in request", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const preview = batchPreview();
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      return { success: true, data: preview } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  await client.previewBatch([RUN_A, RUN_B]);

  assert.equal(calls[0]?.path, "/conversations/import/batch/preview");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    import_run_ids: [RUN_A, RUN_B],
  });
});

test("Conversation Web batch Execute reconstructs backend order from input_index", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const preview = batchPreview();
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      return {
        success: true,
        data: {
          outcome: "executed",
          ...preview,
          items: [],
        },
      } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  await client.executeBatch(preview);

  assert.equal(calls[0]?.path, "/conversations/import/batch/execute");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    import_run_ids: [RUN_A, RUN_B],
    expected_batch_fingerprint: "a".repeat(64),
  });
});

test("Conversation Archive multi-file UI keeps single-file flow and explicit atomic batch confirmation", () => {
  const page = readFileSync(
    new URL("../web/src/pages/ConversationArchivePage.tsx", import.meta.url),
    "utf8",
  );
  const panel = readFileSync(
    new URL("../web/src/pages/ConversationBatchImportPreview.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /multiple/);
  assert.match(page, /files\.length === 1/);
  assert.match(page, /client\.previewBatch\(runIds\)/);
  assert.match(page, /client\.executeBatch\(batchPreview\)/);
  assert.match(page, /一次最多选择 20 份 Conversation export/);
  assert.match(panel, /确认整批导入/);
  assert.match(panel, /SERIALIZABLE Execute/);
  assert.match(panel, /任一文件在执行前变旧都会阻止整批写入/);
});
