import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ActiveUserAuthorizationError } from "../src/domains/require-active-user.js";
import { TodoServiceError } from "../src/domains/todo/todo-service.js";
import { ToyDomainError } from "../src/domains/toy/toy-command-service.js";
import { GlobalSearchError } from "../src/domains/global-search/global-search-service.js";
import {
  TodoReadAuthenticationError,
  registerReadTodoDayTool,
} from "../src/mcp/tools/read-todo-day/register.js";
import { registerListTodoDatesTool } from "../src/mcp/tools/list-todo-dates/register.js";
import {
  WriteTodoPaperAuthenticationError,
  registerReplaceTodoPaperTool,
} from "../src/mcp/tools/write-todo-paper/register.js";
import {
  ToyCommandAuthenticationError,
  registerToyCommandTools,
} from "../src/mcp/tools/toy-command/register.js";
import {
  GlobalSearchAuthenticationError,
  registerGlobalSearchTool,
} from "../src/mcp/tools/global-search/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const RAW = "SECRET_PROVIDER_DATABASE_DETAIL";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;

async function callTool(
  setup: (server: McpServer) => void,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const server = new McpServer({ name: `core-error-${name}`, version: "1.0.0" });
  setup(server);
  const client = new Client({ name: `core-error-${name}-client`, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
    await server.close();
  }
}

function errorOf(result: ToolResult) {
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

function assertRawAbsent(result: ToolResult) {
  assert.equal(JSON.stringify(result).includes(RAW), false);
}

const TODO_WRITE_ARGS = {
  date: "2026-08-26",
  author: "L",
  expected_revision: null,
  entries: [],
  idempotency_key: "core-todo-contract-0001",
};

const TOY_SET_ARGS = {
  percent: 10,
  duration_seconds: 60,
  idempotency_key: "core-toy-set-0001",
};

const TOY_STOP_ARGS = {
  idempotency_key: "core-toy-stop-0001",
};

test("read_todo_day preserves TODO_DATE_INVALID", async () => {
  const result = await callTool((server) => registerReadTodoDayTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    todoService: { async readDay() { throw new TodoServiceError("TODO_DATE_INVALID", RAW); } },
  }), "read_todo_day", { date: "2026-08-26" });
  assert.equal(errorOf(result).code, "TODO_DATE_INVALID");
  assertRawAbsent(result);
});

test("list_todo_dates preserves USER_DISABLED", async () => {
  const result = await callTool((server) => registerListTodoDatesTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    todoService: { async listDates() { throw new TodoServiceError("USER_DISABLED", RAW); } },
  }), "list_todo_dates", {});
  assert.equal(errorOf(result).code, "USER_DISABLED");
  assertRawAbsent(result);
});

test("Todo read auth maps to AUTHENTICATION_REQUIRED", async () => {
  const result = await callTool((server) => registerReadTodoDayTool(server, {
    getAuthenticatedUserId: () => { throw new TodoReadAuthenticationError(); },
    todoService: { async readDay() { throw new Error("service should not run"); } },
  }), "read_todo_day", { date: "2026-08-26" });
  assert.equal(errorOf(result).code, "AUTHENTICATION_REQUIRED");
});

test("replace_todo_paper preserves TODO_PAPER_CONFLICT", async () => {
  const result = await callTool((server) => registerReplaceTodoPaperTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    todoService: { async replacePaperIdempotently() { throw new TodoServiceError("TODO_PAPER_CONFLICT", RAW); } },
  }), "replace_todo_paper", TODO_WRITE_ARGS);
  assert.equal(errorOf(result).code, "TODO_PAPER_CONFLICT");
  assertRawAbsent(result);
});

test("Todo write auth maps to AUTHENTICATION_REQUIRED", async () => {
  const result = await callTool((server) => registerReplaceTodoPaperTool(server, {
    getAuthenticatedUserId: () => { throw new WriteTodoPaperAuthenticationError(); },
    todoService: { async replacePaperIdempotently() { throw new Error("service should not run"); } },
  }), "replace_todo_paper", TODO_WRITE_ARGS);
  assert.equal(errorOf(result).code, "AUTHENTICATION_REQUIRED");
});

test("Todo unknown exceptions map to INTERNAL_ERROR", async () => {
  const result = await callTool((server) => registerReadTodoDayTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    todoService: { async readDay() { throw new Error(RAW); } },
  }), "read_todo_day", { date: "2026-08-26" });
  assert.equal(errorOf(result).code, "INTERNAL_ERROR");
  assertRawAbsent(result);
});

test("toy_set preserves TOY_FORBIDDEN", async () => {
  const result = await callTool((server) => registerToyCommandTools(server, {
    getAuthenticatedUserId: () => USER_ID,
    toyCommandService: { async createIdempotently() { throw new ToyDomainError("TOY_FORBIDDEN", RAW); } },
  }), "toy_set", TOY_SET_ARGS);
  assert.equal(errorOf(result).code, "TOY_FORBIDDEN");
  assertRawAbsent(result);
});

test("toy_stop preserves IDEMPOTENCY_CONFLICT", async () => {
  const result = await callTool((server) => registerToyCommandTools(server, {
    getAuthenticatedUserId: () => USER_ID,
    toyCommandService: { async createIdempotently() { throw new ToyDomainError("IDEMPOTENCY_CONFLICT", RAW); } },
  }), "toy_stop", TOY_STOP_ARGS);
  assert.equal(errorOf(result).code, "IDEMPOTENCY_CONFLICT");
  assertRawAbsent(result);
});

test("Toy active-user authorization preserves USER_DISABLED", async () => {
  const result = await callTool((server) => registerToyCommandTools(server, {
    getAuthenticatedUserId: () => USER_ID,
    toyCommandService: { async createIdempotently() { throw new ActiveUserAuthorizationError("USER_DISABLED"); } },
  }), "toy_set", TOY_SET_ARGS);
  assert.equal(errorOf(result).code, "USER_DISABLED");
});

test("Toy absent MCP auth maps to AUTHENTICATION_REQUIRED", async () => {
  const result = await callTool((server) => registerToyCommandTools(server, {
    getAuthenticatedUserId: () => { throw new ToyCommandAuthenticationError(); },
    toyCommandService: { async createIdempotently() { throw new Error("service should not run"); } },
  }), "toy_stop", TOY_STOP_ARGS);
  assert.equal(errorOf(result).code, "AUTHENTICATION_REQUIRED");
});

test("Toy unknown exceptions map to INTERNAL_ERROR", async () => {
  const result = await callTool((server) => registerToyCommandTools(server, {
    getAuthenticatedUserId: () => USER_ID,
    toyCommandService: { async createIdempotently() { throw new Error(RAW); } },
  }), "toy_set", TOY_SET_ARGS);
  assert.equal(errorOf(result).code, "INTERNAL_ERROR");
  assertRawAbsent(result);
});

test("global_search preserves INVALID_GLOBAL_SEARCH", async () => {
  const result = await callTool((server) => registerGlobalSearchTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    globalSearchService: { async search() { throw new GlobalSearchError("INVALID_GLOBAL_SEARCH", RAW); } },
  }), "global_search", { query: "contract" });
  assert.equal(errorOf(result).code, "INVALID_GLOBAL_SEARCH");
  assertRawAbsent(result);
});

test("global_search preserves USER_DISABLED", async () => {
  const result = await callTool((server) => registerGlobalSearchTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    globalSearchService: { async search() { throw new GlobalSearchError("USER_DISABLED", RAW); } },
  }), "global_search", { query: "contract" });
  assert.equal(errorOf(result).code, "USER_DISABLED");
  assertRawAbsent(result);
});

test("global_search maps absent MCP auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callTool((server) => registerGlobalSearchTool(server, {
    getAuthenticatedUserId: () => { throw new GlobalSearchAuthenticationError(); },
    globalSearchService: { async search() { throw new Error("service should not run"); } },
  }), "global_search", { query: "contract" });
  assert.equal(errorOf(result).code, "AUTHENTICATION_REQUIRED");
});

test("global_search sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callTool((server) => registerGlobalSearchTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    globalSearchService: { async search() { throw new Error(RAW); } },
  }), "global_search", { query: "contract" });
  assert.equal(errorOf(result).code, "INTERNAL_ERROR");
  assertRawAbsent(result);
});
