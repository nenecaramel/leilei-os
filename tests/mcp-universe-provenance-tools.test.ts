import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { UniverseAuthenticationError } from "../src/mcp/tools/universe/shared.js";
import { UniverseServiceError } from "../src/domains/universe/universe-service.js";

const DIARY_ID = "00000000-0000-4000-8000-000000000001";

async function connect(dependencies: Record<string, unknown> = {}) {
  const server = createMcpServer(dependencies as never);
  const client = new Client({ name: "universe-provenance-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const sources = [{ diaryId: DIARY_ID, title: "A diary", date: "2026-08-21", status: "archived" as const }];

test("registers the four Universe provenance/relation MCP tools with frozen annotations", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const byName = new Map((await fixture.client.listTools()).tools.map((tool) => [tool.name, tool]));
  assert.ok(byName.has("delete_universe_relation"));
  assert.ok(byName.has("get_universe_diary_sources"));
  assert.ok(byName.has("add_universe_diary_source"));
  assert.ok(byName.has("delete_universe_diary_source"));
  assert.deepEqual(byName.get("delete_universe_relation")?.annotations, {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
  });
  assert.deepEqual(byName.get("get_universe_diary_sources")?.annotations, {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
  });
  assert.deepEqual(byName.get("add_universe_diary_source")?.annotations, {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false,
  });
  assert.deepEqual(byName.get("delete_universe_diary_source")?.annotations, {
    readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false,
  });
  for (const name of ["delete_universe_relation", "add_universe_diary_source", "delete_universe_diary_source"]) {
    assert.match(byName.get(name)?.description ?? "", /fresh-read/i);
    assert.match(byName.get(name)?.description ?? "", /never blindly retry/i);
  }
});

test("get_universe_diary_sources returns live source metadata and version without body content", async (t) => {
  let calls = 0;
  const fixture = await connect({
    universeProvenanceTools: {
      sourceService: {
        async getUniverseDiarySources(userId: string, nodeId: string) {
          assert.equal(userId, "user-1");
          assert.equal(nodeId, "node-1");
          calls += 1;
          return { nodeId, sources, version: 7 };
        },
      },
      relationService: { async deleteRelation() { throw new Error("not used"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "get_universe_diary_sources", arguments: { node_id: "node-1" } });
  assert.equal(result.isError, undefined);
  assert.deepEqual((result.structuredContent as { data: unknown }).data, {
    node_id: "node-1", sources: [{ diary_id: DIARY_ID, title: "A diary", date: "2026-08-21", status: "archived" }], metadata: { count: 1 }, universe_version: 7,
  });
  assert.doesNotMatch(JSON.stringify(result.structuredContent), /content|body/i);
  assert.equal(calls, 1);
});

test("Universe provenance mutations forward ownership and expected_version and return fresh version", async (t) => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const fixture = await connect({
    universeProvenanceTools: {
      sourceService: {
        async addUniverseDiarySource(...args: unknown[]) {
          calls.push({ name: "add", args });
          return { snapshot: {}, version: 8 };
        },
        async deleteUniverseDiarySource(...args: unknown[]) {
          calls.push({ name: "delete-source", args });
          return { snapshot: {}, version: 9 };
        },
      },
      relationService: {
        async deleteRelation(...args: unknown[]) {
          calls.push({ name: "delete-relation", args });
          return { snapshot: {}, version: 10 };
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const add = await fixture.client.callTool({ name: "add_universe_diary_source", arguments: { node_id: "node-1", diary_id: DIARY_ID, expected_version: 7 } });
  const removeSource = await fixture.client.callTool({ name: "delete_universe_diary_source", arguments: { node_id: "node-1", diary_id: DIARY_ID, expected_version: 8 } });
  const removeRelation = await fixture.client.callTool({ name: "delete_universe_relation", arguments: { relation_id: "edge-1", expected_version: 9 } });
  assert.equal(add.isError, undefined);
  assert.equal(removeSource.isError, undefined);
  assert.equal(removeRelation.isError, undefined);
  assert.deepEqual(calls.map((call) => call.name), ["add", "delete-source", "delete-relation"]);
  assert.deepEqual(calls[0]?.args.slice(1), ["node-1", DIARY_ID, 7]);
  assert.deepEqual(calls[1]?.args.slice(1), ["node-1", DIARY_ID, 8]);
  assert.deepEqual(calls[2]?.args.slice(1), ["edge-1", 9]);
  assert.equal((add.structuredContent as { data: { universe_version: number } }).data.universe_version, 8);
  assert.equal((removeSource.structuredContent as { data: { universe_version: number } }).data.universe_version, 9);
  assert.equal((removeRelation.structuredContent as { data: { universe_version: number } }).data.universe_version, 10);
});

test("Universe provenance tools reject malformed input and map auth/domain errors safely", async (t) => {
  let mutationCalls = 0;
  const fixture = await connect({
    universeProvenanceTools: {
      sourceService: {
        async addUniverseDiarySource() { mutationCalls += 1; throw new UniverseServiceError("DIARY_SOURCE_CONFLICT"); },
        async deleteUniverseDiarySource() { mutationCalls += 1; throw new UniverseServiceError("DIARY_SOURCE_NOT_FOUND"); },
        async getUniverseDiarySources() { throw new UniverseServiceError("NODE_NOT_FOUND"); },
      },
      relationService: { async deleteRelation() { mutationCalls += 1; throw new UniverseServiceError("VERSION_CONFLICT"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const invalid = await fixture.client.callTool({ name: "add_universe_diary_source", arguments: { node_id: "node-1", diary_id: "not-a-uuid", expected_version: 1 } });
  assert.equal(invalid.isError, true);
  assert.equal(mutationCalls, 0);
  const conflict = await fixture.client.callTool({ name: "add_universe_diary_source", arguments: { node_id: "node-1", diary_id: DIARY_ID, expected_version: 1 } });
  assert.equal(conflict.isError, true);
  assert.match(JSON.stringify(conflict), /DIARY_SOURCE_CONFLICT/);
  const notFound = await fixture.client.callTool({ name: "delete_universe_diary_source", arguments: { node_id: "node-1", diary_id: DIARY_ID, expected_version: 1 } });
  assert.equal(notFound.isError, true);
  assert.match(JSON.stringify(notFound), /DIARY_SOURCE_NOT_FOUND/);
  const stale = await fixture.client.callTool({ name: "delete_universe_relation", arguments: { relation_id: "edge-1", expected_version: 1 } });
  assert.equal(stale.isError, true);
  assert.match(JSON.stringify(stale), /VERSION_CONFLICT/);

  const unauthenticated = await connect({
    universeProvenanceTools: {
      sourceService: { async getUniverseDiarySources() { throw new Error("must not call"); } },
      relationService: { async deleteRelation() { throw new Error("must not call"); } },
      getAuthenticatedUserId: () => { throw new UniverseAuthenticationError(); },
    },
  });
  t.after(async () => { await unauthenticated.client.close(); await unauthenticated.server.close(); });
  const denied = await unauthenticated.client.callTool({ name: "get_universe_diary_sources", arguments: { node_id: "node-1" } });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /authentication/i);
});
