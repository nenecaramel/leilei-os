import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiaryDomainError } from "../src/domains/diary/diary-service.js";
import {
  DiaryLifecycleAuthenticationError,
  registerDiaryLifecycleTools,
  type DiaryLifecycleToolDependencies,
} from "../src/mcp/tools/diary-lifecycle/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000901";
const DIARY_ID = "00000000-0000-4000-8000-000000000902";

async function connect(
  dependencies: DiaryLifecycleToolDependencies,
  name: string,
) {
  const server = new McpServer({ name, version: "1.0.0" });
  registerDiaryLifecycleTools(server, dependencies);
  const client = new Client(
    { name: `${name}-client`, version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function errorOf(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.equal(result.isError, true);
  const structured = result.structuredContent as {
    success?: boolean;
    error?: { code?: string; message?: string };
  } | undefined;
  assert.equal(structured?.success, false);
  assert.equal(typeof structured?.error?.code, "string");
  assert.equal(typeof structured?.error?.message, "string");
  return structured!.error!;
}

test("Diary lifecycle MCP inventory exposes strict archive, restore, and permanent-delete tools", async (t) => {
  const pair = await connect({
    getAuthenticatedUserId: () => USER_ID,
    diaryService: {
      archiveMcpDiary: async () => {},
      restoreMcpDiary: async () => {},
      permanentlyDeleteMcpDiary: async () => {},
    },
  }, "diary-lifecycle-inventory");
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const tools = (await pair.client.listTools()).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ["archive_diary", "delete_diary", "restore_diary"],
  );

  for (const name of ["archive_diary", "restore_diary", "delete_diary"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.required, ["id"]);
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.equal(tool.annotations?.idempotentHint, false);
  }

  assert.equal(
    tools.find((tool) => tool.name === "delete_diary")?.annotations?.destructiveHint,
    true,
  );
});

test("Diary lifecycle MCP mutations bind authenticated identity and return exact readback pointers", async (t) => {
  const calls: unknown[] = [];
  const pair = await connect({
    getAuthenticatedUserId: () => USER_ID,
    diaryService: {
      archiveMcpDiary: async (context, input) => {
        calls.push(["archive", context, input]);
      },
      restoreMcpDiary: async (context, input) => {
        calls.push(["restore", context, input]);
      },
      permanentlyDeleteMcpDiary: async (context, input) => {
        calls.push(["delete", context, input]);
      },
    },
  }, "diary-lifecycle-mutations");
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const archived = await pair.client.callTool({
    name: "archive_diary",
    arguments: { id: DIARY_ID },
  });
  assert.equal(archived.isError, undefined);
  assert.deepEqual(
    (archived.structuredContent as {
      data: {
        diary_id: string;
        lifecycle_status: string;
        detail_tool: string;
        detail_arguments: { id: string; scope: string };
      };
    }).data,
    {
      diary_id: DIARY_ID,
      lifecycle_status: "archived",
      outcome: "applied",
      entity_type: "diary",
      entity_id: DIARY_ID,
      revision: null,
      detail_tool: "get_diary",
      detail_arguments: { id: DIARY_ID, scope: "archived" },
    },
  );

  const restored = await pair.client.callTool({
    name: "restore_diary",
    arguments: { id: DIARY_ID },
  });
  assert.equal(restored.isError, undefined);
  assert.deepEqual(
    (restored.structuredContent as {
      data: {
        diary_id: string;
        lifecycle_status: string;
        detail_tool: string;
        detail_arguments: { id: string; scope: string };
      };
    }).data,
    {
      diary_id: DIARY_ID,
      lifecycle_status: "active",
      outcome: "applied",
      entity_type: "diary",
      entity_id: DIARY_ID,
      revision: null,
      detail_tool: "get_diary",
      detail_arguments: { id: DIARY_ID, scope: "active" },
    },
  );

  const deleted = await pair.client.callTool({
    name: "delete_diary",
    arguments: { id: DIARY_ID },
  });
  assert.equal(deleted.isError, undefined);
  assert.deepEqual(
    (deleted.structuredContent as {
      data: { diary_id: string; deleted: boolean };
    }).data,
    {
      diary_id: DIARY_ID,
      deleted: true,
      outcome: "applied",
      entity_type: "diary",
      entity_id: DIARY_ID,
      revision: null,
      detail_tool: null,
      detail_arguments: null,
    },
  );

  assert.deepEqual(calls, [
    ["archive", { userId: USER_ID }, { id: DIARY_ID }],
    ["restore", { userId: USER_ID }, { id: DIARY_ID }],
    ["delete", { userId: USER_ID }, { id: DIARY_ID }],
  ]);
});

test("Diary lifecycle MCP schemas reject extra mutation fields", async (t) => {
  let called = false;
  const pair = await connect({
    getAuthenticatedUserId: () => USER_ID,
    diaryService: {
      archiveMcpDiary: async () => {
        called = true;
      },
      restoreMcpDiary: async () => {},
      permanentlyDeleteMcpDiary: async () => {},
    },
  }, "diary-lifecycle-strict");
  t.after(async () => {
    await pair.client.close();
    await pair.server.close();
  });

  const result = await pair.client.callTool({
    name: "archive_diary",
    arguments: { id: DIARY_ID, user_id: USER_ID },
  });
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test("Diary lifecycle MCP maps authentication and domain failures safely", async (t) => {
  const authPair = await connect({
    getAuthenticatedUserId: () => {
      throw new DiaryLifecycleAuthenticationError();
    },
    diaryService: {
      archiveMcpDiary: async () => {
        throw new Error("service should not run");
      },
      restoreMcpDiary: async () => {},
      permanentlyDeleteMcpDiary: async () => {},
    },
  }, "diary-lifecycle-auth");
  t.after(async () => {
    await authPair.client.close();
    await authPair.server.close();
  });

  const authResult = await authPair.client.callTool({
    name: "archive_diary",
    arguments: { id: DIARY_ID },
  });
  const authError = errorOf(authResult);
  assert.equal(authError.code, "AUTHENTICATION_REQUIRED");
  assert.equal(
    authError.message,
    "Authentication is required to change Diary lifecycle state.",
  );

  const domainPair = await connect({
    getAuthenticatedUserId: () => USER_ID,
    diaryService: {
      archiveMcpDiary: async () => {
        throw new DiaryDomainError(
          "DIARY_NOT_FOUND",
          "SECRET_DIARY_LIFECYCLE_DETAIL",
        );
      },
      restoreMcpDiary: async () => {},
      permanentlyDeleteMcpDiary: async () => {},
    },
  }, "diary-lifecycle-domain");
  t.after(async () => {
    await domainPair.client.close();
    await domainPair.server.close();
  });

  const domainResult = await domainPair.client.callTool({
    name: "archive_diary",
    arguments: { id: DIARY_ID },
  });
  const domainError = errorOf(domainResult);
  assert.equal(domainError.code, "DIARY_NOT_FOUND");
  assert.equal(domainError.message, "Active Diary entry was not found.");
  assert.equal(
    JSON.stringify(domainResult).includes("SECRET_DIARY_LIFECYCLE_DETAIL"),
    false,
  );
});
