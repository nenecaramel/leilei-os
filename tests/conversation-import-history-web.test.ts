import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  createConversationArchiveApi,
  type ConversationImportPreview,
  type ConversationImportSourceHistoryDetail,
  type ConversationImportSourceHistoryItem,
} from "../web/src/pages/conversation-archive-api.js";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

function source(): ConversationImportSourceHistoryItem {
  return {
    sourceId: SOURCE_ID,
    provider: "claude",
    filename: "conversations-000.zip",
    rawSha256: "a".repeat(64),
    rawBytes: 123,
    receivedAt: "2026-09-16T00:00:00.000Z",
    rawSource: {
      kind: "postgres_bytea",
      retained: true,
      encoding: "raw",
      storedBytes: 123,
    },
    runCount: 1,
    processingRunCount: 0,
    executedRunCount: 1,
    failedRunCount: 0,
    supersededRunCount: 0,
    latestRun: {
      id: RUN_ID,
      sourceId: SOURCE_ID,
      parserVersion: "claude-v1",
      executionKey: "standard",
      executionMode: "standard",
      status: "executed",
      rawStatus: "executed",
      previewFingerprint: "b".repeat(64),
      warningCount: 0,
      createdAt: "2026-09-16T00:01:00.000Z",
      completedAt: "2026-09-16T00:02:00.000Z",
      supersededByImportRunId: null,
    },
  };
}

function preview(): ConversationImportPreview {
  return {
    import_run_id: RUN_ID,
    source_id: SOURCE_ID,
    provider: "claude",
    parser_version: "claude-v1",
    filename: "conversations-000.zip",
    raw_sha256: "a".repeat(64),
    raw_bytes: 123,
    source_reused: true,
    already_executed: false,
    preview_fingerprint: "b".repeat(64),
    summary: {
      conversations: { create: 1, update: 0, unchanged: 0, stale: 0 },
      messages: { create: 2, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
    },
    warning_count: 0,
    warning_codes: {},
    exclusions: { conversations: 0, messages: 0, branch_roots: 0 },
  };
}

test("Conversation Web import history adapter uses the source list and detail endpoints", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const item = source();
  const detail: ConversationImportSourceHistoryDetail = {
    ...item,
    runs: [{
      ...item.latestRun!,
      summary: { executed: true },
    }],
  };
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path.includes(SOURCE_ID)) {
        return { success: true, data: detail } as T;
      }
      return { success: true, data: { items: [item], total: 1 } } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  const list = await client.importSources({ provider: "claude", limit: 20, offset: 0 });
  const fetched = await client.importSource(SOURCE_ID);

  assert.equal(list.total, 1);
  assert.equal(fetched.sourceId, SOURCE_ID);
  assert.equal(
    calls[0]?.path,
    "/conversations/import/sources?provider=claude&limit=20&offset=0",
  );
  assert.equal(calls[1]?.path, `/conversations/import/sources/${SOURCE_ID}`);
});

test("preserved-source restore UI requests Preview only and leaves Execute explicit", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const value = preview();
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      return { success: true, data: value } as T;
    },
  };
  const client = createConversationArchiveApi(api);

  const result = await client.previewStoredSource(SOURCE_ID);

  assert.equal(result.import_run_id, RUN_ID);
  assert.deepEqual(calls, [{
    path: `/conversations/import/sources/${SOURCE_ID}/preview`,
    init: { method: "POST" },
  }]);
});

test("Conversation import history panel communicates preserved-source safety and never exposes purge", () => {
  const sourceText = readFileSync(
    new URL("../web/src/pages/ConversationImportHistoryPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sourceText, /只有确认导入后才会写入 Archive/);
  assert.match(sourceText, /重新 Preview/);
  assert.match(sourceText, /raw 已保留/);
  assert.doesNotMatch(sourceText, /purge|privacy erase|DELETE\s+.*source/iu);
});
