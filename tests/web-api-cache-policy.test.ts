import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

async function withServer(callback: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.get("/health", (_request, response) => response.json({ success: true }));
  app.use("/api/v1", createWebApiRouter({
    memory: {
      memoryService: {
        async readMemory() { return { user: { display_name: "Leilei" }, memories: [], metadata: { count: 0 } }; },
        async listAvailableCategories() { return []; },
        async listAvailableTags() { return []; },
      },
    },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: {
      toyService: {
        async create() {
          return { id: "toy-1", action: "stop", percent: null, durationSeconds: null, status: "pending", createdAt: new Date("2026-08-14T00:00:00Z"), expiresAt: new Date("2026-08-14T00:05:00Z") };
        },
      },
    },
    system: {
      systemService: {
        async readDataSummary() { return { memory: { active: 0, archived: 0 }, diary: { active: 0, archived: 0 }, task: { active: 0, archived: 0 }, shared_paper: { active: 0, archived: 0 }, todo: { active: 0 } }; },
      },
    },
    todo: { todoService: { async listDates() { return []; } } },
    export: { exportService: { async createExport() { return { schema_version: 2, exported_at: "2026-08-14T00:00:00.000Z", data: { memory: [] } }; } } },
    import: { importService: { async preview() { return { package_sha256: "a".repeat(64), preview_fingerprint: "b".repeat(64), summary: {}, can_execute: false }; } } },
    conversationFavorite: {
      conversationFavoriteService: {
        async list() { return { items: [], total: 0 }; },
        async detail() {
          return {
            id: "44444444-4444-4444-8444-444444444444",
            provider: "chatgpt",
            sourceConversationId: "source",
            conversationId: "11111111-1111-4111-8111-111111111111",
            view: "default",
            title: "Favorite",
            note: null,
            tags: [],
            conversationTitleSnapshot: "Test",
            startMessageId: "22222222-2222-4222-8222-222222222222",
            endMessageId: "22222222-2222-4222-8222-222222222222",
            startSourceNodeId: "node",
            endSourceNodeId: "node",
            messageCount: 1,
            canonicalConversationExists: true,
            createdAt: "2026-09-16T00:00:00.000Z",
            updatedAt: "2026-09-16T00:00:00.000Z",
            messages: [],
          };
        },
        async create() { return this.detail(); },
        async update() { return this.detail(); },
        async delete() { return { deleted: true }; },
      },
    },
    conversationExclusionManagement: {
      conversationExclusionManagementService: {
        async list() { return { items: [], total: 0 }; },
        async remove() {
          return {
            removed: true,
            exclusion: {
              id: "55555555-5555-4555-8555-555555555555",
              provider: "chatgpt",
              scope: "branch",
              sourceConversationId: "source",
              sourceNodeId: "node",
              canonicalConversationExists: true,
              canonicalNodeExists: false,
              createdAt: "2026-09-16T00:00:00.000Z",
            },
            canonicalRestored: false,
            eligibleOnNextImport: true,
          };
        },
      },
    },
    conversationRead: {
      conversationArchiveReadService: {
        async list() { return { items: [], total: 0 }; },
        async detail() {
          return {
            id: "11111111-1111-4111-8111-111111111111",
            provider: "chatgpt",
            sourceConversationId: "source",
            title: "Test",
            sourceCreatedAt: null,
            sourceUpdatedAt: null,
            defaultModel: null,
            currentLeafSourceNodeId: null,
            messageCount: 0,
            turnCount: 0,
            totalNodeCount: 0,
            providerMetadata: {},
          };
        },
        async messages() { return { items: [], total: 0 }; },
        async search() { return { items: [], total: 0 }; },
        async messageContext() { return { items: [], total: 0, offset: 0, anchorIndex: 0 }; },
        async stats() { return []; },
      },
    },
    conversationPruning: {
      conversationPruningService: {
        async deleteConversation() {
          return {
            provider: "chatgpt",
            sourceConversationId: "source",
            deletedMessages: 1,
            rawSourcePreserved: true,
          };
        },
        async deleteBranch() {
          return {
            provider: "chatgpt",
            sourceConversationId: "source",
            sourceNodeId: "node",
            deletedMessages: 1,
            remainingMessages: 1,
            currentLeafSourceNodeId: null,
            rawSourcePreserved: true,
          };
        },
      },
    },
    conversationImport: {
      conversationImportService: {
        async preview() {
          return {
            import_run_id: "run",
            source_id: "source",
            provider: "chatgpt",
            parser_version: "chatgpt-v1",
            filename: "conversations.json",
            raw_sha256: "a".repeat(64),
            raw_bytes: 2,
            source_reused: false,
            already_executed: false,
            preview_fingerprint: "b".repeat(64),
            summary: {
              conversations: { create: 0, update: 0, unchanged: 0, stale: 0 },
              messages: { create: 0, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
            },
            warning_count: 0,
            warning_codes: {},
          };
        },
        async execute() {
          return {
            outcome: "executed",
            import_run_id: "11111111-1111-4111-8111-111111111111",
            source_id: "source",
            provider: "chatgpt",
            parser_version: "chatgpt-v1",
            preview_fingerprint: "b".repeat(64),
            summary: {
              conversations: { create: 0, update: 0, unchanged: 0, stale: 0 },
              messages: { create: 0, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
            },
            warning_count: 0,
            warning_codes: {},
          };
        },
      },
    },
  } as never));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("authenticated Web API responses are private and uncached without affecting root health", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "x-test-user": "yes", "content-type": "application/json" };
    const requests: Array<{ path: string; init?: RequestInit }> = [
      { path: "/api/v1/session", init: { headers } },
      { path: "/api/v1/memory", init: { headers } },
      { path: "/api/v1/todo/dates", init: { headers } },
      { path: "/api/v1/system/data", init: { headers } },
      { path: "/api/v1/system/export?scope=memory", init: { headers } },
      { path: "/api/v1/system/import/preview", init: { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: new Uint8Array([123]) } },
      { path: "/api/v1/conversations/exclusions", init: { headers } },
      { path: "/api/v1/conversations/exclusions/55555555-5555-4555-8555-555555555555", init: { method: "DELETE", headers } },
      { path: "/api/v1/conversations/favorites", init: { headers } },
      { path: "/api/v1/conversations/favorites", init: { method: "POST", headers, body: JSON.stringify({ conversation_id: "11111111-1111-4111-8111-111111111111", start_message_id: "22222222-2222-4222-8222-222222222222" }) } },
      { path: "/api/v1/conversations/favorites/44444444-4444-4444-8444-444444444444", init: { headers } },
      { path: "/api/v1/conversations/favorites/44444444-4444-4444-8444-444444444444", init: { method: "PATCH", headers, body: JSON.stringify({ title: "Updated" }) } },
      { path: "/api/v1/conversations/favorites/44444444-4444-4444-8444-444444444444", init: { method: "DELETE", headers } },
      { path: "/api/v1/conversations", init: { headers } },
      { path: "/api/v1/conversations/stats/daily?from=2026-09-01&to=2026-09-16&time_zone=Asia%2FShanghai", init: { headers } },
      { path: "/api/v1/conversations/11111111-1111-4111-8111-111111111111", init: { headers } },
      { path: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages", init: { headers } },
      { path: "/api/v1/conversations/search?q=test", init: { headers } },
      { path: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/messages/22222222-2222-4222-8222-222222222222/context", init: { headers } },
      { path: "/api/v1/conversations/11111111-1111-4111-8111-111111111111", init: { method: "DELETE", headers } },
      { path: "/api/v1/conversations/11111111-1111-4111-8111-111111111111/branches/22222222-2222-4222-8222-222222222222", init: { method: "DELETE", headers } },
      { path: "/api/v1/conversations/import/preview", init: { method: "POST", headers: { ...headers, "content-type": "application/octet-stream", "x-leilei-filename": "conversations.json" }, body: new Uint8Array([91, 93]) } },
      { path: "/api/v1/conversations/import/execute", init: { method: "POST", headers, body: JSON.stringify({ import_run_id: "11111111-1111-4111-8111-111111111111", expected_preview_fingerprint: "b".repeat(64) }) } },
      { path: "/api/v1/toy/commands", init: { method: "POST", headers, body: JSON.stringify({ action: "stop" }) } },
    ];
    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, request.init);
      assert.equal(response.headers.get("cache-control"), "private, no-store", request.path);
    }
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), null);
  });
});
