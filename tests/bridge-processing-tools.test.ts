import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerBridgeProcessingTools } from "../src/mcp/tools/bridge-processing/register.js";
import { ActiveUserAuthorizationError } from "../src/domains/require-active-user.js";
import { BridgeDomainError } from "../src/domains/bridge/bridge-service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const EVENT = {
  id: EVENT_ID,
  status: "host_sent" as const,
  processingState: "claimed" as const,
  createdAt: new Date("2026-08-29T00:00:00.000Z"),
  modelClaimedAt: new Date("2026-08-29T00:01:00.000Z"),
  modelCompletedAt: null,
  deliveryReconciledAt: null,
};

async function connected(server: McpServer) {
  const client = new Client({ name: "bridge-processing-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("bridge processing tools expose strict claim/complete contracts and safe outcomes", async (t) => {
  const calls: Array<[string, string]> = [];
  const server = new McpServer({ name: "bridge-processing", version: "1.0.0" });
  registerBridgeProcessingTools(server, {
    bridgeService: {
      claimEvent: async (userId, eventId) => { calls.push(["claim", `${userId}:${eventId}`]); return EVENT; },
      completeEvent: async (userId, eventId) => { calls.push(["complete", `${userId}:${eventId}`]); return { ...EVENT, processingState: "completed", modelCompletedAt: new Date("2026-08-29T00:02:00.000Z") }; },
    },
    getAuthenticatedUserId: () => USER_ID,
    requireActiveUser: async () => USER_ID,
  });
  const pair = await connected(server);
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const listed = await pair.client.listTools();
  assert.ok(listed.tools.some((tool) => tool.name === "bridge_event_claim"));
  assert.ok(listed.tools.some((tool) => tool.name === "bridge_event_complete"));
  const claim = await pair.client.callTool({ name: "bridge_event_claim", arguments: { eventId: EVENT_ID } });
  assert.equal(claim.isError, undefined);
  assert.equal((claim.structuredContent as { success: boolean }).success, true);
  assert.deepEqual(calls[0], ["claim", `${USER_ID}:${EVENT_ID}`]);
  const invalid = await pair.client.callTool({ name: "bridge_event_claim", arguments: { eventId: EVENT_ID, userId: USER_ID } });
  assert.equal(invalid.isError, true);
  assert.equal(calls.length, 1);
});

test("bridge processing tools map conflicts, not-found, auth, and unknown failures safely", async (t) => {
  let mode: "not_found" | "conflict" | "auth" | "unknown" = "not_found";
  const server = new McpServer({ name: "bridge-processing-errors", version: "1.0.0" });
  registerBridgeProcessingTools(server, {
    bridgeService: {
      claimEvent: async () => {
        if (mode === "not_found") throw new BridgeDomainError("EVENT_NOT_FOUND", "private sentinel");
        if (mode === "conflict") throw new BridgeDomainError("PROCESSING_CONFLICT", "private sentinel");
        if (mode === "auth") throw new Error("authorization private sentinel");
        throw new Error("database private sentinel");
      },
      completeEvent: async () => EVENT,
    },
    getAuthenticatedUserId: () => {
      if (mode === "auth") throw new ActiveUserAuthorizationError("USER_DISABLED");
      return USER_ID;
    },
    requireActiveUser: async () => {
      if (mode === "auth") throw new ActiveUserAuthorizationError("USER_DISABLED");
      return USER_ID;
    },
  });
  const pair = await connected(server);
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  for (const [nextMode, expectedCode] of [["not_found", "EVENT_NOT_FOUND"], ["conflict", "PROCESSING_CONFLICT"], ["unknown", "INTERNAL_ERROR"]] as const) {
    mode = nextMode;
    const result = await pair.client.callTool({ name: "bridge_event_claim", arguments: { eventId: EVENT_ID } });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { error: { code: string } }).error.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(result), /private sentinel/);
  }
  mode = "auth";
  const authResult = await pair.client.callTool({ name: "bridge_event_claim", arguments: { eventId: EVENT_ID } });
  assert.equal((authResult.structuredContent as { error: { code: string } }).error.code, "AUTHENTICATION_REQUIRED");
});
