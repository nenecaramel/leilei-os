import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import {
  createReadMemoryApiHandler,
  createReadMemoryDetailApiHandler,
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
    },
  });
  const request = {
    webUserId: "11111111-1111-4111-8111-111111111111",
  } as Request;
  const { result, response } = responseRecorder();

  await handler(request, response, (() => {}) as NextFunction);

  assert.deepEqual(calls, [{ userId: request.webUserId }]);
  assert.deepEqual(result.body, { success: true, data: expected });
});

test("does not call Memory Service without a Web identity", async () => {
  let called = false;
  const handler = createReadMemoryApiHandler({
    memoryService: {
      readMemory: async () => {
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
    },
  });
  const { result, response } = responseRecorder();

  await handler(
    { webUserId: "11111111-1111-4111-8111-111111111111" } as Request,
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
