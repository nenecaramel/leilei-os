import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSentinelTools } from "../src/mcp/tools/sentinel/register.js";
import { SentinelDomainError } from "../src/domains/sentinel/sentinel-service.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WAKE_ID = "22222222-2222-4222-8222-222222222222";

async function connected(dependencies: Record<string, unknown>) {
  const server = new McpServer({ name: "sentinel-mcp", version: "1" });
  registerSentinelTools(server, dependencies.sentinelTools as never);
  const client = new Client({ name: "sentinel-mcp-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("Sentinel tools expose strict read/finalize contracts and derive owner from session", async (t) => {
  const calls: string[] = [];
  const eventId = "44444444-4444-4444-8444-444444444444";
  const fixture = await connected({
    sentinelTools: {
      sentinelService: {
        getWakeState: async (userId: string, wakeId: string) => {
          calls.push(`${userId}:${wakeId}`);
          return {
            wakeId,
            sentinelId: "33333333-3333-4333-8333-333333333333",
            controlRevision: 2,
            scheduledFor: new Date("2026-08-30T00:00:00.000Z"),
            policyPrompt: "",
            contextCapsule: null,
            nextWakeAt: null,
            lastValidWakeAt: null,
            currentTime: new Date("2026-08-30T00:00:00.000Z"),
            timezone: "Asia/Shanghai",
            limits: { minNextWakeSeconds: 300, maxNextWakeSeconds: 604800 },
          };
        },
        completeWake: async () => ({
          outcome: "applied",
          wake: {
            id: WAKE_ID,
            decision: "quiet",
            nextWakeAt: new Date("2026-08-30T00:10:00.000Z"),
            finalizedAt: new Date("2026-08-30T00:01:00.000Z"),
          },
          sentinel: { controlRevision: 3 },
          bridge: {},
        }),
        claimCurrentWake: async (userId: string) => {
          calls.push(`claim:${userId}`);
          return {
            outcome: "applied",
            wake: { id: WAKE_ID, claimedAt: new Date("2026-08-30T00:00:02.000Z") },
            sentinel: {
              id: "33333333-3333-4333-8333-333333333333",
              controlRevision: 2,
            },
            bridge: { id: eventId },
          };
        },
      },
      getAuthenticatedUserId: () => USER_ID,
      requireActiveUser: async () => USER_ID,
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const tools = await fixture.client.listTools();
  const names = tools.tools.map((tool) => tool.name);
  assert.ok(names.includes("sentinel_get_state"));
  assert.ok(names.includes("complete_sentinel_wake"));
  assert.ok(names.includes("sentinel_claim_current_wake"));
  assert.equal((tools.tools.find((tool) => tool.name === "sentinel_get_state")?.inputSchema.properties ?? {}).user_id, undefined);
  assert.equal((tools.tools.find((tool) => tool.name === "complete_sentinel_wake")?.inputSchema.properties ?? {}).user_id, undefined);
  const claimTool = tools.tools.find((tool) => tool.name === "sentinel_claim_current_wake");
  assert.equal(claimTool?.inputSchema.type, "object");
  assert.deepEqual(claimTool?.inputSchema.properties, {});

  const state = await fixture.client.callTool({ name: "sentinel_get_state", arguments: { wakeId: WAKE_ID } });
  assert.equal(state.isError, undefined);
  assert.equal((state.structuredContent as { data: { wakeId: string } }).data.wakeId, WAKE_ID);
  assert.equal(calls[0], `${USER_ID}:${WAKE_ID}`);

  const claim = await fixture.client.callTool({ name: "sentinel_claim_current_wake", arguments: {} });
  assert.equal(claim.isError, undefined);
  assert.deepEqual((claim.structuredContent as { data: unknown }).data, {
    outcome: "applied",
    wakeId: WAKE_ID,
    eventId,
    sentinelId: "33333333-3333-4333-8333-333333333333",
    controlRevision: 2,
    claimedAt: "2026-08-30T00:00:02.000Z",
  });
  assert.equal(calls[1], `claim:${USER_ID}`);

  const completion = await fixture.client.callTool({
    name: "complete_sentinel_wake",
    arguments: {
      wakeId: WAKE_ID,
      decision: "quiet",
      nextWakeAt: "2026-08-30T00:10:00.000Z",
      contextCapsule: "",
    },
  });
  assert.equal(completion.isError, undefined);
  assert.equal((completion.structuredContent as { data: { outcome: string } }).data.outcome, "applied");
});

test("Sentinel finalizer rejects malformed and conflicting states through safe errors", async (t) => {
  const fixture = await connected({
    sentinelTools: {
      sentinelService: {
        getWakeState: async () => { throw Object.assign(new Error("private"), { code: "SENTINEL_WAKE_CONFLICT" }); },
        completeWake: async () => { throw Object.assign(new Error("private"), { code: "SENTINEL_WAKE_CONFLICT" }); },
        claimCurrentWake: async () => { throw new SentinelDomainError("NO_ACTIVE_WAKE", "private"); },
      },
      getAuthenticatedUserId: () => USER_ID,
      requireActiveUser: async () => USER_ID,
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const invalid = await fixture.client.callTool({ name: "complete_sentinel_wake", arguments: {
    wakeId: WAKE_ID,
    decision: "contact",
    nextWakeAt: "not-a-date",
    contextCapsule: "x",
  } });
  assert.equal(invalid.isError, true);
  const conflict = await fixture.client.callTool({ name: "sentinel_get_state", arguments: { wakeId: WAKE_ID } });
  assert.equal(conflict.isError, true);
  assert.doesNotMatch(JSON.stringify(conflict), /private/);

  const noActive = await fixture.client.callTool({ name: "sentinel_claim_current_wake", arguments: {} });
  assert.equal(noActive.isError, true);
  assert.equal((noActive.structuredContent as { error: { code: string } }).error.code, "NO_ACTIVE_WAKE");
  assert.doesNotMatch(JSON.stringify(noActive), /private/);
});

test("sentinel_claim_current_wake rejects explicit identity and illegal wake state", async (t) => {
  let calls = 0;
  const fixture = await connected({
    sentinelTools: {
      sentinelService: {
        getWakeState: async () => { throw new Error("unused"); },
        completeWake: async () => { throw new Error("unused"); },
        claimCurrentWake: async () => {
          calls += 1;
          throw new SentinelDomainError("SENTINEL_WAKE_CONFLICT", "private");
        },
      },
      getAuthenticatedUserId: () => USER_ID,
      requireActiveUser: async () => USER_ID,
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const malformed = await fixture.client.callTool({
    name: "sentinel_claim_current_wake",
    arguments: { wakeId: WAKE_ID },
  });
  assert.equal(malformed.isError, true);
  assert.equal(calls, 0);

  const conflict = await fixture.client.callTool({
    name: "sentinel_claim_current_wake",
    arguments: {},
  });
  assert.equal(conflict.isError, true);
  assert.equal((conflict.structuredContent as { error: { code: string } }).error.code, "SENTINEL_WAKE_CONFLICT");
  assert.doesNotMatch(JSON.stringify(conflict), /private/);
});

test("complete_sentinel_wake validates capsule length by Unicode code point", async (t) => {
  const capsules: string[] = [];
  const fixture = await connected({
    sentinelTools: {
      sentinelService: {
        getWakeState: async () => {
          throw new Error("unused");
        },
        completeWake: async (_userId: string, input: { contextCapsule: string }) => {
          capsules.push(input.contextCapsule);
          return {
            outcome: "applied",
            wake: {
              id: WAKE_ID,
              decision: "quiet",
              nextWakeAt: new Date("2026-08-30T00:10:00.000Z"),
              finalizedAt: new Date("2026-08-30T00:01:00.000Z"),
            },
            sentinel: { controlRevision: 3 },
            bridge: {},
          };
        },
      },
      getAuthenticatedUserId: () => USER_ID,
      requireActiveUser: async () => USER_ID,
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const emojiCapsule = "🙂".repeat(1_024);
  const accepted = await fixture.client.callTool({
    name: "complete_sentinel_wake",
    arguments: {
      wakeId: WAKE_ID,
      decision: "quiet",
      nextWakeAt: "2026-08-30T00:10:00.000Z",
      contextCapsule: emojiCapsule,
    },
  });
  assert.equal(accepted.isError, undefined);
  assert.equal(capsules[0], emojiCapsule);

  const rejected = await fixture.client.callTool({
    name: "complete_sentinel_wake",
    arguments: {
      wakeId: WAKE_ID,
      decision: "quiet",
      nextWakeAt: "2026-08-30T00:10:00.000Z",
      contextCapsule: `${emojiCapsule}🙂`,
    },
  });
  assert.equal(rejected.isError, true);
  assert.equal(capsules.length, 1);
});
