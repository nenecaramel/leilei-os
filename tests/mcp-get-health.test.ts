import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HealthDailySummary } from "../src/domains/health-v2/health-types.js";
import { getProductDate } from "../src/domains/time/current-time.js";
import { registerGetHealthTool } from "../src/mcp/tools/get-health/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000512";
const SUMMARY: HealthDailySummary = {
  date: "2026-09-06",
  steps: 6842,
  menstruating: true,
  periodStartDate: "2026-09-04",
  cycleDay: 3,
  updatedAt: new Date("2026-09-06T04:30:00.000Z"),
};

class MockHealthService {
  dayCalls: Array<{ userId: string; date: string }> = [];
  recentCalls: Array<{ userId: string; days: number }> = [];
  day: HealthDailySummary | null = SUMMARY;
  recent: HealthDailySummary[] = [SUMMARY];
  error: unknown;

  async readDay(userId: string, date: string): Promise<HealthDailySummary | null> {
    this.dayCalls.push({ userId, date });
    if (this.error) throw this.error;
    return this.day;
  }

  async readRecent(userId: string, days: number): Promise<HealthDailySummary[]> {
    this.recentCalls.push({ userId, days });
    if (this.error) throw this.error;
    return this.recent;
  }
}

async function connect(service: MockHealthService) {
  const server = new McpServer({ name: "health-tool-test", version: "1" });
  registerGetHealthTool(server, {
    healthService: service,
    getAuthenticatedUserId: () => USER_ID,
  });
  const client = new Client({ name: "health-tool-client", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("get_health exposes strict public read schema and annotations", async (t) => {
  const { client, server } = await connect(new MockHealthService());
  t.after(async () => { await client.close(); await server.close(); });

  const tool = (await client.listTools()).tools.find((candidate) => candidate.name === "get_health");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), ["date", "days"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("get_health reads today's stored day by authenticated owner without fabricating a missing record", async (t) => {
  const service = new MockHealthService();
  service.day = null;
  const { client, server } = await connect(service);
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "get_health", arguments: {} });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.dayCalls, [{ userId: USER_ID, date: getProductDate(new Date()) }]);
  assert.deepEqual(service.recentCalls, []);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: { timezone: "Asia/Shanghai", records: [] },
  });
});

test("get_health reads an exact day and formats only the stable public fields", async (t) => {
  const service = new MockHealthService();
  const { client, server } = await connect(service);
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "get_health", arguments: { date: "2026-09-06" } });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.dayCalls, [{ userId: USER_ID, date: "2026-09-06" }]);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      timezone: "Asia/Shanghai",
      records: [{
        date: "2026-09-06",
        steps: 6842,
        menstruating: true,
        period_start_date: "2026-09-04",
        cycle_day: 3,
        updated_at: "2026-09-06T04:30:00.000Z",
      }],
    },
  });
});

test("get_health reads ascending bounded recent records", async (t) => {
  const service = new MockHealthService();
  service.recent = [
    { ...SUMMARY, date: "2026-09-05", steps: 12 },
    SUMMARY,
  ];
  const { client, server } = await connect(service);
  t.after(async () => { await client.close(); await server.close(); });

  const result = await client.callTool({ name: "get_health", arguments: { days: 7 } });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.dayCalls, []);
  assert.deepEqual(service.recentCalls, [{ userId: USER_ID, days: 7 }]);
  assert.deepEqual((result.structuredContent as { data: { records: Array<{ date: string }> } }).data.records.map((row) => row.date), ["2026-09-05", "2026-09-06"]);
});

test("get_health rejects ambiguous, malformed, identity, and unknown input before reads", async () => {
  for (const arguments_ of [
    { date: "2026-09-06", days: 7 },
    { days: 0 },
    { days: 61 },
    { date: "09-06-2026" },
    { date: "2026-02-30" },
    { date: "2999-01-01" },
    { user_id: USER_ID },
    { userId: USER_ID },
    { unexpected: true },
  ]) {
    const service = new MockHealthService();
    const { client, server } = await connect(service);
    const result = await client.callTool({ name: "get_health", arguments: arguments_ });
    assert.equal(result.isError, true, JSON.stringify(arguments_));
    assert.deepEqual(service.dayCalls, [], JSON.stringify(arguments_));
    assert.deepEqual(service.recentCalls, [], JSON.stringify(arguments_));
    await client.close();
    await server.close();
  }
});
