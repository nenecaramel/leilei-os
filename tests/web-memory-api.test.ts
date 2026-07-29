import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import {
  createCreateMemoryApiHandler,
  createReadMemoryApiHandler,
  createReadMemoryDetailApiHandler,
  createUpdateMemoryApiHandler,
} from "../src/web-api/memory-router.js";

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status: (status: number) => {
      result.status = status;
      return response;
    },
    json: (body: unknown) => {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  return { result, response };
}

test("reads Memory through the existing service with the Web identity", async () => {
  const calls: unknown[] = [];
  const expected = {
    user: { display_name: "Leilei" },
    memories: [
      {
        category: "preference" as const,
        key: "working_style",
        content: "Prefer calm, structured plans.",
        tags: ["focus"],
        source: "web",
        updated_at: "2026-07-22T00:00:00.000Z",
      },
    ],
    metadata: { count: 1 },
  };
  const handler = createReadMemoryApiHandler({
    memoryService: {
      readMemory: async (input) => {
        calls.push(input);
        return expected;
      },
      listAvailableCategories: async (userId) => {
        calls.push({ categoriesFor: userId });
        return ["preference"];
      },
      listAvailableTags: async (userId) => {
        calls.push({ tagsFor: userId });
        return ["focus"];
      },
    },
  });
  const request = {
    webUserId: "11111111-1111-4111-8111-111111111111",
    query: {},
  } as Request;
  const { result, response } = responseRecorder();

  await handler(request, response, (() => {}) as NextFunction);

  assert.deepEqual(calls, [
    {
      userId: request.webUserId,
      query: undefined,
      categories: undefined,
      tag: undefined,
      includeSource: true,
    },
    { categoriesFor: request.webUserId },
    { tagsFor: request.webUserId },
  ]);
  assert.deepEqual(result.body, {
    success: true,
    data: {
      ...expected,
      metadata: {
        count: 1,
        categories: ["preference"],
        tags: ["focus"],
      },
    },
  });
});

test("passes q and exact category independently to Memory Service", async () => {
  const calls: unknown[] = [];
  const handler = createReadMemoryApiHandler({
    memoryService: {
      async readMemory(input) {
        calls.push(input);
        return {
          user: { display_name: "Leilei" },
          memories: [],
          metadata: { count: 0 },
        };
      },
      async listAvailableCategories(userId) {
        calls.push({ categoriesFor: userId });
        return ["goal"];
      },
      async listAvailableTags(userId) {
        calls.push({ tagsFor: userId });
        return ["MCP"];
      },
    },
  } as never);
  const request = {
    webUserId: "11111111-1111-4111-8111-111111111111",
    query: {
      q: "100%_focused\\plan",
      category: "goal",
      tag: "MCP",
    },
  } as unknown as Request;
  const { result, response } = responseRecorder();

  await handler(request, response, (() => {}) as NextFunction);

  assert.deepEqual(calls, [
    {
      userId: request.webUserId,
      query: "100%_focused\\plan",
      categories: ["goal"],
      tag: "MCP",
      includeSource: true,
    },
    { categoriesFor: request.webUserId },
    { tagsFor: request.webUserId },
  ]);
  assert.equal(result.status, undefined);
});

test("rejects a category containing special characters with a safe 400", async () => {
  const handler = createReadMemoryApiHandler({
    memoryService: {
      async readMemory() {
        throw new MemoryDomainError(
          "INVALID_MEMORY_CATEGORY",
          "private category detail",
        );
      },
      async listAvailableCategories() {
        return [];
      },
      async listAvailableTags() {
        return [];
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "11111111-1111-4111-8111-111111111111",
      query: { category: "goal%_\\<script>" },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "INVALID_REQUEST",
      message: "The memory request is invalid.",
    },
  });
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /private category detail|script/,
  );
});

test("does not call Memory Service without a Web identity", async () => {
  let called = false;
  const handler = createReadMemoryApiHandler({
    memoryService: {
      readMemory: async () => {
        called = true;
        throw new Error("must not be called");
      },
      listAvailableCategories: async () => {
        called = true;
        throw new Error("must not be called");
      },
      listAvailableTags: async () => {
        called = true;
        throw new Error("must not be called");
      },
    },
  });
  const { result, response } = responseRecorder();

  await handler({} as Request, response, (() => {}) as NextFunction);

  assert.equal(called, false);
  assert.equal(result.status, 401);
});

test("returns a safe error for unavailable authenticated users", async () => {
  const handler = createReadMemoryApiHandler({
    memoryService: {
      readMemory: async () => {
        throw new MemoryDomainError("USER_DISABLED", "internal detail");
      },
      listAvailableCategories: async () => [],
      listAvailableTags: async () => [],
    },
  });
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "11111111-1111-4111-8111-111111111111",
      query: {},
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "MEMORY_UNAVAILABLE",
      message: "Memory is unavailable for the authenticated user.",
    },
  });
});

test("reads one Memory with only the authenticated Web user identity", async () => {
  const calls: unknown[] = [];
  const expected = {
    id: "11111111-1111-4111-8111-111111111111",
    category: "goal" as const,
    key: "current_goal",
    content: "Ship the next focused milestone.",
    tags: ["goal"],
    source: "phase_2_validation",
    updated_at: "2026-07-28T00:00:00.000Z",
  };
  const handler = createReadMemoryDetailApiHandler({
    memoryService: {
      readMemoryDetail: async (input) => {
        calls.push(input);
        return expected;
      },
    },
  } as never);
  const request = {
    webUserId: "22222222-2222-4222-8222-222222222222",
    params: { id: expected.id },
  } as unknown as Request;
  const { result, response } = responseRecorder();

  await handler(request, response, (() => {}) as NextFunction);

  assert.deepEqual(calls, [{
    userId: request.webUserId,
    id: expected.id,
  }]);
  assert.deepEqual(result.body, { success: true, data: expected });
});

test("Memory detail returns the same safe 404 for missing and inaccessible records", async () => {
  const handler = createReadMemoryDetailApiHandler({
    memoryService: {
      readMemoryDetail: async () => {
        throw new MemoryDomainError(
          "MEMORY_NOT_FOUND",
          "private repository detail",
        );
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "22222222-2222-4222-8222-222222222222",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "MEMORY_NOT_FOUND",
      message: "Memory was not found.",
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /private repository detail/);
});

test("Memory detail rejects unauthenticated requests before the service", async () => {
  let called = false;
  const handler = createReadMemoryDetailApiHandler({
    memoryService: {
      readMemoryDetail: async () => {
        called = true;
        throw new Error("must not run");
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    { params: { id: "memory-id" } } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(called, false);
  assert.equal(result.status, 401);
});

test("Memory create and update ignore client source and use only editable fields", async () => {
  const calls: unknown[] = [];
  const dependencies = {
    memoryService: {
      async createMemory(input: unknown) {
        calls.push({ create: input });
      },
      async updateMemory(input: unknown) {
        calls.push({ update: input });
      },
    },
  } as never;
  const create = createCreateMemoryApiHandler(dependencies);
  const update = createUpdateMemoryApiHandler(dependencies);
  const { response: createResponse } = responseRecorder();
  const { response: updateResponse } = responseRecorder();

  await create(
    {
      webUserId: "user-a",
      body: {
        category: "goal",
        key: "memory_key",
        content: "Content",
        tags: ["计划", "MCP"],
        source: "chatgpt_mcp",
        userId: "attacker",
      },
    } as unknown as Request,
    createResponse,
    (() => {}) as NextFunction,
  );
  await update(
    {
      webUserId: "user-a",
      body: {
        id: "memory-1",
        content: "Updated",
        tags: ["MCP"],
        source: "system",
        userId: "attacker",
      },
    } as unknown as Request,
    updateResponse,
    (() => {}) as NextFunction,
  );

  assert.deepEqual(calls, [
    {
      create: {
        userId: "user-a",
        category: "goal",
        key: "memory_key",
        content: "Content",
        tags: ["计划", "MCP"],
      },
    },
    {
      update: {
        userId: "user-a",
        id: "memory-1",
        content: "Updated",
        tags: ["MCP"],
      },
    },
  ]);
});
