import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import {
  createMcpToolError,
  mcpToolErrorStructuredContentSchema,
} from "../src/mcp/tools/error-contract.js";
import {
  ReadMemoryAuthenticationError,
  registerReadMemoryTool,
} from "../src/mcp/tools/read-memory/register.js";
import { registerSearchMemoryTool } from "../src/mcp/tools/search-memory/register.js";
import { registerGetMemoryTool } from "../src/mcp/tools/get-memory/register.js";
import {
  WriteMemoryAuthenticationError,
  registerWriteMemoryTool,
} from "../src/mcp/tools/write-memory/register.js";
import {
  UpdateMemoryAuthenticationError,
  registerUpdateMemoryTool,
} from "../src/mcp/tools/update-memory/register.js";

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

function assertSecretAbsent(
  result: Awaited<ReturnType<Client["callTool"]>>,
  secret: string,
) {
  assert.equal(JSON.stringify(result).includes(secret), false);
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

async function callSearchMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "search-memory-error-contract", version: "1.0.0" });
  registerSearchMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "search-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "search_memory",
      arguments: { query: "contract" },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callGetMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "get-memory-error-contract", version: "1.0.0" });
  registerGetMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async readMemoryDetail() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "get-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "get_memory",
      arguments: { id: "memory-contract-id" },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callWriteMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "write-memory-error-contract", version: "1.0.0" });
  registerWriteMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async createMcpMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "write-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "write_memory",
      arguments: {
        category: "profile",
        key: "contract-key",
        content: "contract-content",
        author: "L",
        idempotency_key: "mcp-error-contract-memory-0001",
      },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callUpdateMemoryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "update-memory-error-contract", version: "1.0.0" });
  registerUpdateMemoryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    memoryService: {
      async updateMcpMemory() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "update-memory-error-client");
  try {
    return await pair.client.callTool({
      name: "update_memory",
      arguments: { id: "memory-contract-id", tags: ["contract"] },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

test("shared MCP tool error helper emits the strict machine-readable envelope", () => {
  const result = createMcpToolError(
    "INTERNAL_ERROR",
    "Memory is temporarily unavailable.",
  );

  assert.equal(result.isError, true);
  assert.deepEqual(result.content, [
    { type: "text", text: "Memory is temporarily unavailable." },
  ]);
  assert.deepEqual(
    mcpToolErrorStructuredContentSchema.parse(result.structuredContent),
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Memory is temporarily unavailable.",
      },
    },
  );
  assert.throws(() =>
    mcpToolErrorStructuredContentSchema.parse({
      ...result.structuredContent,
      unexpected: true,
    }),
  );
});

test("read_memory preserves a stable domain error code in structuredContent", async () => {
  const result = await callReadMemoryFailure({
    error: new MemoryDomainError("USER_DISABLED", "SECRET_DOMAIN_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "USER_DISABLED");
  assert.equal(error.message, "Memory is unavailable for the authenticated user.");
  assertSecretAbsent(result, "SECRET_DOMAIN_DETAIL");
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
  assertSecretAbsent(result, "SECRET_DATABASE_DETAIL");
});

test("search_memory preserves domain error codes without leaking detail", async () => {
  const result = await callSearchMemoryFailure({
    error: new MemoryDomainError("INVALID_MEMORY_QUERY", "SECRET_SEARCH_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INVALID_MEMORY_QUERY");
  assert.equal(error.message, "The Memory search is invalid.");
  assertSecretAbsent(result, "SECRET_SEARCH_DETAIL");
});

test("search_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callSearchMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to search memory.");
});

test("search_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callSearchMemoryFailure({
    error: new Error("SECRET_SEARCH_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_SEARCH_DATABASE_DETAIL");
});

test("get_memory preserves MEMORY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callGetMemoryFailure({
    error: new MemoryDomainError("MEMORY_NOT_FOUND", "SECRET_GET_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "MEMORY_NOT_FOUND");
  assert.equal(error.message, "Memory was not found.");
  assertSecretAbsent(result, "SECRET_GET_DETAIL");
});

test("get_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callGetMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new ReadMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read memory.");
});

test("get_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callGetMemoryFailure({
    error: new Error("SECRET_GET_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_GET_DATABASE_DETAIL");
});

test("write_memory preserves idempotency conflicts as machine-readable codes", async () => {
  const result = await callWriteMemoryFailure({
    error: new MemoryDomainError("IDEMPOTENCY_CONFLICT", "SECRET_WRITE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(
    error.message,
    "This idempotency key was already used for different Memory content.",
  );
  assertSecretAbsent(result, "SECRET_WRITE_DETAIL");
});

test("write_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callWriteMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new WriteMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to write Memory.");
});

test("write_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callWriteMemoryFailure({
    error: new Error("SECRET_WRITE_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory writing is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_WRITE_DATABASE_DETAIL");
});

test("update_memory preserves MEMORY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callUpdateMemoryFailure({
    error: new MemoryDomainError("MEMORY_NOT_FOUND", "SECRET_UPDATE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "MEMORY_NOT_FOUND");
  assert.equal(error.message, "Memory was not found.");
  assertSecretAbsent(result, "SECRET_UPDATE_DETAIL");
});

test("update_memory maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callUpdateMemoryFailure({
    getAuthenticatedUserId: () => {
      throw new UpdateMemoryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to update Memory.");
});

test("update_memory sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callUpdateMemoryFailure({
    error: new Error("SECRET_UPDATE_DATABASE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Memory updating is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_UPDATE_DATABASE_DETAIL");
});
