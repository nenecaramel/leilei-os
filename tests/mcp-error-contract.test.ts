import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import {
  ReadMemoryAuthenticationError,
  registerReadMemoryTool,
} from "../src/mcp/tools/read-memory/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

async function connectServer(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
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

async function callReadMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "read-memory-error-contract", version: "1.0.0" });
  registerReadMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "read-memory-error-client");
  try {
    return await pair.client.callTool({ name: "read_memory", arguments: {} });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

test("read_memory preserves a stable domain error code in structuredContent", async () => {
  const result = await callReadMemoryFailure({
    error: new MemoryDomainError("USER_DISABLED", "SECRET_DOMAIN_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "USER_DISABLED");
  assert.equal(error.message, "Memory is unavailable for the authenticated user.");
  assert.equal(JSON.stringify(result).includes("SECRET_DOMAIN_DETAIL"), false);
});

test("read_memory maps missing MCP auth context to AUTHENTICATION_REQUIRED", async () => {
  const result = await callReadMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read memory.");
});

test("read_memory sanitizes an unknown exception as INTERNAL_ERROR", async () => {
  const result = await callReadMemoryFailure({
    error: new Error("SECRET_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assert.equal(JSON.stringify(result).includes("SECRET_DATABASE_DETAIL"), false);
});
