import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  MemoryDomainError,
  type ReadMemoryDetailResult,
  type ReadMemoryInput,
  type ReadMemoryResult,
} from "../src/domains/memory/memory-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { ReadMemoryAuthenticationError } from "../src/mcp/tools/read-memory/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const MEMORY_ID = "memory-active-assistant";
const UPDATED_AT = "2026-07-29T08:00:00.000Z";

class MockMemoryReadService {
  readCalls: ReadMemoryInput[] = [];
  detailCalls: Array<{ userId: string; id: string }> = [];
  archivedDetailCalls: Array<{ userId: string; id: string }> = [];
  readError?: unknown;
  detailError?: unknown;
  includeSyntheticSource = false;

  async readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult> {
    this.readCalls.push(input);
    if (this.readError) throw this.readError;

    return {
      user: { display_name: "Leilei" },
      memories: [
        {
          id: MEMORY_ID,
          category: "project",
          key: "leilei-os",
          content: "Bounded Memory search result.",
          tags: ["MCP", "Memory"],
          ...(this.includeSyntheticSource
            ? { source: "must-not-leak" }
            : {}),
          updated_at: UPDATED_AT,
        },
      ],
      metadata: { count: 1 },
    };
  }

  async readMemoryDetail(input: {
    userId: string;
    id: string;
  }): Promise<ReadMemoryDetailResult> {
    this.detailCalls.push(input);
    if (this.detailError) throw this.detailError;

    return {
      id: MEMORY_ID,
      category: "project",
      key: "leilei-os",
      content: "Complete active Memory detail.",
      tags: ["MCP", "Memory"],
      source: "web",
      updated_at: UPDATED_AT,
      lifecycle_status: "active",
    };
  }

  async readArchivedMemoryDetail(input: { userId: string; id: string }): Promise<ReadMemoryDetailResult> {
    this.archivedDetailCalls.push(input);
    return { id: input.id, category: "project", key: "archived", content: "Archived complete content", tags: [], source: "web", updated_at: UPDATED_AT };
  }
}

async function connect(
  service: MockMemoryReadService,
  getAuthenticatedUserId: () => string = () => USER_ID,
) {
  const server = createMcpServer({
    memoryReads: {
      memoryService: service,
      getAuthenticatedUserId,
    },
  });
  const client = new Client(
    { name: "memory-read-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

test("registers read_memory, search_memory, and get_memory as read-only tools", async (t) => {
  const { client, server } = await connect(new MockMemoryReadService());
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  for (const name of ["read_memory", "search_memory", "get_memory"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("search_memory injects identity and forces updated ordering without source", async (t) => {
  const service = new MockMemoryReadService();
  service.includeSyntheticSource = true;
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "search_memory",
    arguments: {
      query: "  Leilei OS  ",
      categories: ["project"],
      tag: "  MCP  ",
      limit: 12,
    },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.readCalls, [
    {
      userId: USER_ID,
      query: "Leilei OS",
      categories: ["project"],
      tag: "MCP",
      ordering: "updated_desc",
      limit: 12,
    },
  ]);
  assert.equal("includeSource" in service.readCalls[0], false);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      memories: [
        {
          id: MEMORY_ID,
          category: "project",
          key: "leilei-os",
          content: "Bounded Memory search result.",
          tags: ["MCP", "Memory"],
          updated_at: UPDATED_AT,
        },
      ],
      metadata: { count: 1 },
    },
  });
  assert.equal(
    JSON.stringify(result.structuredContent).includes("must-not-leak"),
    false,
  );
});

test("search_memory rejects invalid query, category, tag, and limit before service", async (t) => {
  const invalidInputs = [
    { query: "" },
    { query: "x", categories: ["unknown"] },
    { query: "x", tag: "" },
    { query: "x", limit: 0 },
    { query: "x", limit: 51 },
    { query: "x", limit: 1.5 },
  ];

  for (const arguments_ of invalidInputs) {
    const service = new MockMemoryReadService();
    const { client, server } = await connect(service);
    const result = await client.callTool({
      name: "search_memory",
      arguments: arguments_,
    });
    assert.equal(result.isError, true);
    assert.equal(service.readCalls.length, 0);
    await client.close();
    await server.close();
  }
});

test("search_memory maps unavailable, invalid-domain, and unexpected errors safely", async (t) => {
  const cases: Array<{ error: unknown; expected: RegExp; secret?: string }> = [
    {
      error: new MemoryDomainError("USER_DISABLED", "private disabled detail"),
      expected: /unavailable for the authenticated user/i,
      secret: "private disabled detail",
    },
    {
      error: new MemoryDomainError("INVALID_MEMORY_TAGS", "private tag detail"),
      expected: /search is invalid/i,
      secret: "private tag detail",
    },
    {
      error: new Error("SQL password and internal query"),
      expected: /temporarily unavailable/i,
      secret: "SQL password",
    },
  ];

  for (const { error, expected, secret } of cases) {
    const service = new MockMemoryReadService();
    service.readError = error;
    const { client, server } = await connect(service);
    const result = await client.callTool({
      name: "search_memory",
      arguments: { query: "memory" },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), expected);
    assert.equal(textOf(result).includes(secret ?? ""), false);
    await client.close();
    await server.close();
  }
});

test("get_memory injects identity, trims id, and returns only safe fields", async (t) => {
  const service = new MockMemoryReadService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "get_memory",
    arguments: { id: `  ${MEMORY_ID}  ` },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.detailCalls, [
    { userId: USER_ID, id: MEMORY_ID },
  ]);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      id: MEMORY_ID,
      category: "project",
      key: "leilei-os",
      content: "Complete active Memory detail.",
      tags: ["MCP", "Memory"],
      source: "web",
      updated_at: UPDATED_AT,
      lifecycle_status: "active",
    },
  });
});

test("get_memory archived scope uses only the archived detail path", async (t) => {
  const service=new MockMemoryReadService(); const {client,server}=await connect(service); t.after(async()=>{await client.close();await server.close();});
  const result=await client.callTool({name:"get_memory",arguments:{id:"archived-memory",scope:"archived"}});
  assert.equal(result.isError,undefined); assert.equal(service.detailCalls.length,0); assert.deepEqual(service.archivedDetailCalls,[{userId:USER_ID,id:"archived-memory"}]); assert.equal((result.structuredContent as {data:{lifecycle_status:string}}).data.lifecycle_status,"archived");
});

test("get_memory rejects empty ids before service and preserves non-UUID ids", async (t) => {
  const service = new MockMemoryReadService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const invalid = await client.callTool({
    name: "get_memory",
    arguments: { id: " " },
  });
  assert.equal(invalid.isError, true);
  assert.equal(service.detailCalls.length, 0);

  await client.callTool({
    name: "get_memory",
    arguments: { id: "legacy-memory-id" },
  });
  assert.deepEqual(service.detailCalls, [
    { userId: USER_ID, id: "legacy-memory-id" },
  ]);
});

test("get_memory returns indistinguishable not-found errors for inaccessible records", async (t) => {
  const service = new MockMemoryReadService();
  service.detailError = new MemoryDomainError(
    "MEMORY_NOT_FOUND",
    "cross-user private archived record",
  );
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "get_memory",
    arguments: { id: "inaccessible" },
  });
  assert.equal(result.isError, true);
  assert.equal(textOf(result), "Memory was not found.");
  assert.doesNotMatch(textOf(result), /cross-user|private|archived/i);
});

test("get_memory maps unavailable and unexpected failures without internals", async (t) => {
  const cases: Array<{ error: unknown; expected: RegExp }> = [
    {
      error: new MemoryDomainError("USER_NOT_FOUND", "private user id"),
      expected: /unavailable for the authenticated user/i,
    },
    {
      error: new Error("SQL SELECT private fields"),
      expected: /temporarily unavailable/i,
    },
  ];

  for (const { error, expected } of cases) {
    const service = new MockMemoryReadService();
    service.detailError = error;
    const { client, server } = await connect(service);
    const result = await client.callTool({
      name: "get_memory",
      arguments: { id: MEMORY_ID },
    });
    assert.equal(result.isError, true);
    assert.match(textOf(result), expected);
    assert.doesNotMatch(textOf(result), /SQL|private user id/i);
    await client.close();
    await server.close();
  }
});

test("both new tools fail safely without authenticated MCP context", async (t) => {
  const service = new MockMemoryReadService();
  const { client, server } = await connect(service, () => {
    throw new ReadMemoryAuthenticationError();
  });
  t.after(async () => {
    await client.close();
    await server.close();
  });

  for (const request of [
    { name: "search_memory", arguments: { query: "memory" } },
    { name: "get_memory", arguments: { id: MEMORY_ID } },
  ]) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Authentication is required/i);
  }
  assert.equal(service.readCalls.length, 0);
  assert.equal(service.detailCalls.length, 0);
});

test("legacy read_memory contract and default ordering remain unchanged", async (t) => {
  const service = new MockMemoryReadService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const result = await client.callTool({
    name: "read_memory",
    arguments: {
      categories: ["project"],
      keys: ["leilei-os"],
    },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(service.readCalls, [
    {
      userId: USER_ID,
      categories: ["project"],
      keys: ["leilei-os"],
    },
  ]);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      user: { display_name: "Leilei" },
      memories: [
        {
          id: MEMORY_ID,
          category: "project",
          key: "leilei-os",
          content: "Bounded Memory search result.",
          tags: ["MCP", "Memory"],
          updated_at: UPDATED_AT,
        },
      ],
      metadata: { count: 1 },
    },
  });
});
