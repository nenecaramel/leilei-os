import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DiaryDomainError } from "../src/domains/diary/diary-service.js";
import {
  DiaryReadAuthenticationError,
  registerSearchDiaryTool,
} from "../src/mcp/tools/search-diary/register.js";
import { registerGetDiaryTool } from "../src/mcp/tools/get-diary/register.js";
import {
  WriteDiaryAuthenticationError,
  registerCreateDiaryTool,
} from "../src/mcp/tools/write-diary/register.js";
import {
  UpdateDiaryAuthenticationError,
  registerUpdateDiaryTool,
} from "../src/mcp/tools/update-diary/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DIARY_ID = "00000000-0000-4000-8000-000000000305";

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

async function callSearchDiaryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "search-diary-error-contract", version: "1.0.0" });
  registerSearchDiaryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    diaryService: {
      async listDiaries() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "search-diary-error-client");
  try {
    return await pair.client.callTool({
      name: "search_diary",
      arguments: { query: "contract" },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callGetDiaryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "get-diary-error-contract", version: "1.0.0" });
  registerGetDiaryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    diaryService: {
      async readDiary() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "get-diary-error-client");
  try {
    return await pair.client.callTool({
      name: "get_diary",
      arguments: { id: DIARY_ID },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callWriteDiaryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "write-diary-error-contract", version: "1.0.0" });
  registerCreateDiaryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    diaryService: {
      async createMcpDiary() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "write-diary-error-client");
  try {
    return await pair.client.callTool({
      name: "create_diary",
      arguments: {
        title: "Contract",
        content: "Diary contract content",
        date: "2026-08-26",
        tags: ["contract"],
        author: "L",
        idempotency_key: "mcp-error-contract-diary-0001",
      },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

async function callUpdateDiaryFailure(input: {
  getAuthenticatedUserId?: () => string;
  error: unknown;
}) {
  const server = new McpServer({ name: "update-diary-error-contract", version: "1.0.0" });
  registerUpdateDiaryTool(server, {
    getAuthenticatedUserId: input.getAuthenticatedUserId ?? (() => USER_ID),
    diaryService: {
      async updateMcpDiary() {
        throw input.error;
      },
    },
  });
  const pair = await connectServer(server, "update-diary-error-client");
  try {
    return await pair.client.callTool({
      name: "update_diary",
      arguments: { id: "diary-contract-id", tags: ["contract"] },
    });
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

test("update_diary accepts C author reassignment", async () => {
  const server = new McpServer({ name: "update-diary-c-author", version: "1.0.0" });
  registerUpdateDiaryTool(server, {
    getAuthenticatedUserId: () => USER_ID,
    diaryService: {
      async updateMcpDiary(_context, input) {
        return {
          id: input.id,
          title: "Claude diary",
          content: "A C-authored entry.",
          date: "2026-09-05",
          tags: [],
          mood: null,
          author: input.author ?? "C",
          created_at: "2026-09-05T08:00:00.000Z",
          updated_at: "2026-09-05T09:00:00.000Z",
        };
      },
    },
  });
  const pair = await connectServer(server, "update-diary-c-author-client");
  try {
    const result = await pair.client.callTool({
      name: "update_diary",
      arguments: { id: "diary-c", content: "Edited by Claude.", author: "C" },
    });
    assert.equal(result.isError, undefined);
    assert.equal(
      (result.structuredContent as { data: { author: string } }).data.author,
      "C",
    );
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
});

test("search_diary preserves domain error codes without leaking detail", async () => {
  const result = await callSearchDiaryFailure({
    error: new DiaryDomainError("INVALID_DIARY_QUERY", "SECRET_SEARCH_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "INVALID_DIARY_QUERY");
  assert.equal(error.message, "The Diary search is invalid.");
  assertSecretAbsent(result, "SECRET_SEARCH_DETAIL");
});

test("search_diary maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callSearchDiaryFailure({
    getAuthenticatedUserId: () => {
      throw new DiaryReadAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read Diary.");
});

test("search_diary sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callSearchDiaryFailure({ error: new Error("SECRET_SEARCH_DATABASE_DETAIL") });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Diary is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_SEARCH_DATABASE_DETAIL");
});

test("get_diary preserves DIARY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callGetDiaryFailure({
    error: new DiaryDomainError("DIARY_NOT_FOUND", "SECRET_GET_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "DIARY_NOT_FOUND");
  assert.equal(error.message, "Diary entry was not found.");
  assertSecretAbsent(result, "SECRET_GET_DETAIL");
});

test("get_diary maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callGetDiaryFailure({
    getAuthenticatedUserId: () => {
      throw new DiaryReadAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to read Diary.");
});

test("get_diary sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callGetDiaryFailure({ error: new Error("SECRET_GET_DATABASE_DETAIL") });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Diary is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_GET_DATABASE_DETAIL");
});

test("create_diary preserves idempotency conflicts as machine-readable codes", async () => {
  const result = await callWriteDiaryFailure({
    error: new DiaryDomainError("IDEMPOTENCY_CONFLICT", "SECRET_WRITE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(error.message, "This idempotency key was already used for different diary content.");
  assertSecretAbsent(result, "SECRET_WRITE_DETAIL");
});

test("create_diary maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callWriteDiaryFailure({
    getAuthenticatedUserId: () => {
      throw new WriteDiaryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to write a diary entry.");
});

test("create_diary sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callWriteDiaryFailure({ error: new Error("SECRET_WRITE_DATABASE_DETAIL") });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Diary writing is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_WRITE_DATABASE_DETAIL");
});

test("update_diary preserves DIARY_NOT_FOUND as a machine-readable code", async () => {
  const result = await callUpdateDiaryFailure({
    error: new DiaryDomainError("DIARY_NOT_FOUND", "SECRET_UPDATE_DETAIL"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "DIARY_NOT_FOUND");
  assert.equal(error.message, "Diary entry was not found.");
  assertSecretAbsent(result, "SECRET_UPDATE_DETAIL");
});

test("update_diary maps missing auth to AUTHENTICATION_REQUIRED", async () => {
  const result = await callUpdateDiaryFailure({
    getAuthenticatedUserId: () => {
      throw new UpdateDiaryAuthenticationError();
    },
    error: new Error("service should not run"),
  });
  const error = errorOf(result);
  assert.equal(error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(error.message, "Authentication is required to update Diary.");
});

test("update_diary sanitizes unknown exceptions as INTERNAL_ERROR", async () => {
  const result = await callUpdateDiaryFailure({ error: new Error("SECRET_UPDATE_DATABASE_DETAIL") });
  const error = errorOf(result);
  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, "Diary updating is temporarily unavailable.");
  assertSecretAbsent(result, "SECRET_UPDATE_DATABASE_DETAIL");
});
