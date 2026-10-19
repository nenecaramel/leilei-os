import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  NativeLiveConcernError,
  type NativeLiveConcernView,
} from "../src/domains/bridge/concern/native-live-concern.js";
import { registerUpdateConcernTool } from "../src/mcp/tools/update-concern/register.js";

const userId = "11111111-1111-4111-8111-111111111111";
const concernId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function view(overrides: Partial<NativeLiveConcernView> = {}): NativeLiveConcernView {
  return {
    id: concernId,
    content: "惦记他今天面试的结果",
    reason: null,
    progress: null,
    consider_at: "2026-10-19T17:00:00+08:00",
    expires_at: "2026-10-20T23:59:00+08:00",
    status: "active",
    release_reason: null,
    revision: 1,
    wake_count: 0,
    max_wakes: 3,
    last_woken_at: null,
    ...overrides,
  };
}

async function connect(service: Parameters<typeof registerUpdateConcernTool>[1]["concernService"]) {
  const server = new McpServer({ name: "concern-test", version: "1.0.0" });
  registerUpdateConcernTool(server, { concernService: service, requireActiveUser: async () => userId });
  const client = new Client({ name: "concern-test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    call: (args: Record<string, unknown>) =>
      client.callTool({ name: "update_concern", arguments: args }),
    close: async () => { await client.close(); await server.close(); },
  };
}

test("update_concern creates, edits, releases and lists through one tool", async () => {
  const calls: Array<[string, unknown]> = [];
  const tool = await connect({
    async create(input) { calls.push(["create", input]); return { concern: view(), replayed: false }; },
    async update(input) { calls.push(["update", input]); return view({ revision: 2 }); },
    async release(input) {
      calls.push(["release", input]);
      return view({ status: "released", release_reason: "resolved", revision: 3 });
    },
    async list(input) { calls.push(["list", input]); return { conversationId: null, concerns: [view()] }; },
  });
  try {
    const created = await tool.call({
      action: "create",
      content: "惦记他今天面试的结果",
      reason: "他下午两点面试",
      consider_in_minutes: 180,
      expires_at: "2026-10-20T23:59:00+08:00",
    });
    assert.equal(created.isError, undefined);
    assert.equal((created.structuredContent as { data: { concern: { id: string } } }).data.concern.id, concernId);

    const updated = await tool.call({
      action: "update", concern_id: concernId, expected_revision: 1, consider_in_minutes: 60,
      progress: "面试延期到明天",
    });
    assert.equal(updated.isError, undefined);

    const released = await tool.call({
      action: "release", concern_id: concernId, expected_revision: 2, outcome: "resolved",
    });
    assert.equal(released.isError, undefined);
    await tool.call({ action: "list" });

    assert.deepEqual(calls, [
      ["create", {
        userId, content: "惦记他今天面试的结果", reason: "他下午两点面试",
        considerInMinutes: 180, expiresAt: "2026-10-20T23:59:00+08:00",
      }],
      ["update", {
        userId, concernId, expectedRevision: 1, progress: "面试延期到明天", considerInMinutes: 60,
      }],
      ["release", { userId, concernId, expectedRevision: 2, outcome: "resolved" }],
      ["list", { userId }],
    ]);
  } finally {
    await tool.close();
  }
});

test("update_concern exposes no program-owned limits and rejects incomplete actions", async () => {
  const tool = await connect({
    async create() { throw new Error("unreachable"); },
    async update() { throw new Error("unreachable"); },
    async release() { throw new Error("unreachable"); },
    async list() { throw new Error("unreachable"); },
  });
  try {
    for (const args of [
      { action: "create", content: "x", consider_in_minutes: 30 },
      { action: "update", concern_id: concernId },
      { action: "release", concern_id: concernId, expected_revision: 1 },
      { action: "create", content: "x", consider_in_minutes: 30, expires_at: "2026-10-20T23:59:00+08:00", outcome: "dropped" },
    ]) {
      const result = await tool.call(args);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.equal((result.structuredContent as { error: { code: string } }).error.code, "INVALID_INPUT");
    }
    for (const args of [
      { action: "update", concern_id: concernId, expected_revision: 1, wake_count: 0 },
      { action: "update", concern_id: concernId, expected_revision: 1, max_wakes: 99 },
      { action: "create", content: "x", consider_in_minutes: 1, expires_at: "2026-10-20T23:59:00+08:00" },
    ]) {
      const result = await tool.call(args);
      assert.equal(result.isError, true, JSON.stringify(args));
    }
  } finally {
    await tool.close();
  }
});

test("a stale revision is reported with the current state instead of overwriting it", async () => {
  const tool = await connect({
    async create() { throw new Error("unreachable"); },
    async update() {
      throw new NativeLiveConcernError("STALE_REVISION", "Concern revision is 3; re-read it before editing.",
        view({ revision: 3 }));
    },
    async release() {
      throw new NativeLiveConcernError("CONCERN_NOT_ACTIVE", "Concern is already released.",
        view({ status: "released", release_reason: "dropped", revision: 4 }));
    },
    async list() { throw new Error("unreachable"); },
  });
  try {
    const stale = await tool.call({ action: "update", concern_id: concernId, expected_revision: 1, content: "new" });
    assert.equal(stale.isError, true);
    const error = (stale.structuredContent as { error: Record<string, unknown> }).error;
    assert.equal(error.code, "STALE_REVISION");
    assert.equal(error.reason, "stale_revision");
    assert.equal(error.current_revision, 3);
    const closed = await tool.call({ action: "release", concern_id: concernId, expected_revision: 3, outcome: "resolved" });
    assert.equal((closed.structuredContent as { error: Record<string, unknown> }).error.reason, "status_conflict");
  } finally {
    await tool.close();
  }
});
