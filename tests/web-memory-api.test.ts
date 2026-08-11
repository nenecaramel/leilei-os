import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import {
  createCreateMemoryApiHandler,
  createArchiveMemoryApiHandler,
  createReadArchivedMemoriesApiHandler,
  createReadArchivedMemoryDetailApiHandler,
  createReadMemoryApiHandler,
  createReadMemoryDetailApiHandler,
  createRestoreMemoryApiHandler,
  createUpdateMemoryApiHandler,
} from "../src/web-api/memory-router.js";

test("Memory restore API uses authenticated identity and returns success", async () => {
  const calls: unknown[] = [];
  const handler = createRestoreMemoryApiHandler({
    memoryService: {
      async restoreMemory(input) {
        calls.push(input);
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "user-a",
      params: { id: "archived-1" },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.deepEqual(calls, [{ userId: "user-a", id: "archived-1" }]);
  assert.deepEqual(result.body, { success: true });
});

test("Memory restore API rejects unauthenticated requests before mutation", async () => {
  let called = false;
  const handler = createRestoreMemoryApiHandler({
    memoryService: {
      async restoreMemory() {
        called = true;
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    { params: { id: "archived-1" } } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );
  assert.equal(called, false);
  assert.equal(result.status, 401);
});

for (const code of [
  "MEMORY_NOT_FOUND",
  "USER_NOT_FOUND",
  "USER_DISABLED",
] as const) {
  test(`Memory restore API safely maps ${code}`, async () => {
    const handler = createRestoreMemoryApiHandler({
      memoryService: {
        async restoreMemory() {
          throw new MemoryDomainError(code, "private internal detail");
        },
      },
    } as never);
    const { result, response } = responseRecorder();

    await handler(
      {
        webUserId: "user-a",
        params: { id: "archived-1" },
      } as unknown as Request,
      response,
      (() => {}) as NextFunction,
    );
    assert.equal(result.status, code === "MEMORY_NOT_FOUND" ? 404 : 403);
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private internal detail/,
    );
  });
}

test("Memory restore API uses a safe 503 for unexpected failures", async () => {
  const handler = createRestoreMemoryApiHandler({
    memoryService: {
      async restoreMemory() {
        throw new Error("private database detail");
      },
    },
  } as never);
  const { result, response } = responseRecorder();
  await handler(
    {
      webUserId: "user-a",
      params: { id: "archived-1" },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );
  assert.equal(result.status, 503);
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /private database detail/,
  );
});

test("Memory archived detail API uses authenticated identity and safe response", async () => {
  const calls: unknown[] = [];
  const expected = {
    id: "archived-1",
    category: "goal" as const,
    key: "archived_goal",
    content: "Archived content",
    tags: ["archive"],
    source: "web",
    author: null,
    updated_at: "2026-07-29T01:00:00.000Z",
  };
  const handler = createReadArchivedMemoryDetailApiHandler({
    memoryService: {
      async readArchivedMemoryDetail(input) {
        calls.push(input);
        return expected;
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "user-a",
      params: { id: "archived-1" },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.deepEqual(calls, [{ userId: "user-a", id: "archived-1" }]);
  assert.deepEqual(result.body, { success: true, data: expected });
});

test("Memory archived detail API rejects unauthenticated requests", async () => {
  let called = false;
  const handler = createReadArchivedMemoryDetailApiHandler({
    memoryService: {
      async readArchivedMemoryDetail() {
        called = true;
        throw new Error("must not run");
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    { params: { id: "archived-1" } } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );
  assert.equal(called, false);
  assert.equal(result.status, 401);
});

for (const code of [
  "MEMORY_NOT_FOUND",
  "USER_NOT_FOUND",
  "USER_DISABLED",
] as const) {
  test(`Memory archived detail API safely maps ${code}`, async () => {
    const handler = createReadArchivedMemoryDetailApiHandler({
      memoryService: {
        async readArchivedMemoryDetail() {
          throw new MemoryDomainError(code, "private internal detail");
        },
      },
    } as never);
    const { result, response } = responseRecorder();

    await handler(
      {
        webUserId: "user-a",
        params: { id: "archived-1" },
      } as unknown as Request,
      response,
      (() => {}) as NextFunction,
    );

    assert.equal(result.status, code === "MEMORY_NOT_FOUND" ? 404 : 403);
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private internal detail/,
    );
  });
}

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
        author: "L",
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
      ordering: "updated_desc",
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
      ordering: "updated_desc",
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
    author: "L",
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
        author: "L",
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
        key: "renamed_key",
        category: "project",
        content: "Updated",
        tags: ["MCP"],
        author: "G",
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
        author: "L",
      },
    },
    {
      update: {
        userId: "user-a",
        id: "memory-1",
        key: "renamed_key",
        category: "project",
        content: "Updated",
        tags: ["MCP"],
        author: "G",
      },
    },
  ]);
});

test("Memory create maps missing author to a safe client error", async () => {
  let called = false;
  const handler = createCreateMemoryApiHandler({
    memoryService: {
      async createMemory() {
        called = true;
        throw new MemoryDomainError(
          "AUTHOR_REQUIRED",
          "private author detail",
        );
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {
      webUserId: "user-a",
      body: {
        category: "goal",
        key: "memory-key",
        content: "Content",
      },
    } as unknown as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(called, true);
  assert.equal(result.status, 400);
  assert.doesNotMatch(JSON.stringify(result.body), /private author detail/);
});

test("Memory update maps AUTHOR_REQUIRED to the stable safe client error", async () => {
  const handler = createUpdateMemoryApiHandler({
    memoryService: {
      async updateMemory() {
        throw new MemoryDomainError("AUTHOR_REQUIRED", "private author detail");
      },
    },
  } as never);
  const { result, response } = responseRecorder();
  await handler({
    webUserId: "user-a",
    body: { id: "memory-1", key: "key", category: "goal", content: "content" },
  } as unknown as Request, response, (() => {}) as NextFunction);
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    success: false,
    error: { code: "AUTHOR_REQUIRED", message: "Author selection is required." },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /private author detail/);
});

for (const operation of ["update", "archive"] as const) {
  test(`Memory ${operation} returns a safe 404 for missing or inaccessible records`, async () => {
    const dependencies = {
      memoryService: {
        async updateMemory() {
          throw new MemoryDomainError(
            "MEMORY_NOT_FOUND",
            "private repository detail",
          );
        },
        async archiveMemory() {
          throw new MemoryDomainError(
            "MEMORY_NOT_FOUND",
            "private repository detail",
          );
        },
      },
    } as never;
    const handler =
      operation === "update"
        ? createUpdateMemoryApiHandler(dependencies)
        : createArchiveMemoryApiHandler(dependencies);
    const { result, response } = responseRecorder();

    await handler(
      {
        webUserId: "user-a",
        body: {
          id: "inaccessible-memory",
          content: "Updated",
        },
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
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private repository detail|inaccessible-memory/,
    );
  });
}

for (const operation of ["create", "update", "archive"] as const) {
  for (const code of ["USER_NOT_FOUND", "USER_DISABLED"] as const) {
    test(`Memory ${operation} maps ${code} to the existing unavailable response`, async () => {
      const unavailable = async () => {
        throw new MemoryDomainError(code, "private user detail");
      };
      const dependencies = {
        memoryService: {
          createMemory: unavailable,
          updateMemory: unavailable,
          archiveMemory: unavailable,
        },
      } as never;
      const handler =
        operation === "create"
          ? createCreateMemoryApiHandler(dependencies)
          : operation === "update"
            ? createUpdateMemoryApiHandler(dependencies)
            : createArchiveMemoryApiHandler(dependencies);
      const { result, response } = responseRecorder();

      await handler(
        {
          webUserId: "user-a",
          body: {
            id: "memory-1",
            category: "goal",
            key: "memory-key",
            content: "Content",
          },
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
      assert.doesNotMatch(
        JSON.stringify(result.body),
        /private user detail/,
      );
    });
  }
}

test("Memory archived API reads only through the authenticated user service path", async () => {
  const calls: unknown[] = [];
  const expected = {
    memories: [{
      id: "memory-archived",
      category: "goal" as const,
      key: "archived_goal",
      content: "Archived content",
      tags: ["archive"],
      source: "web",
      author: null,
      updated_at: "2026-07-29T01:00:00.000Z",
    }],
    metadata: { count: 1 },
  };
  const handler = createReadArchivedMemoriesApiHandler({
    memoryService: {
      async readArchivedMemories(input) {
        calls.push(input);
        return expected;
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    { webUserId: "user-a" } as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.deepEqual(calls, [{ userId: "user-a" }]);
  assert.deepEqual(result.body, {
    success: true,
    data: expected,
  });
});

test("Memory archived API rejects unauthenticated requests before the service", async () => {
  let called = false;
  const handler = createReadArchivedMemoriesApiHandler({
    memoryService: {
      async readArchivedMemories() {
        called = true;
        throw new Error("must not run");
      },
    },
  } as never);
  const { result, response } = responseRecorder();

  await handler(
    {} as Request,
    response,
    (() => {}) as NextFunction,
  );

  assert.equal(called, false);
  assert.equal(result.status, 401);
});

for (const code of ["USER_NOT_FOUND", "USER_DISABLED"] as const) {
  test(`Memory archived API maps ${code} to the existing unavailable response`, async () => {
    const handler = createReadArchivedMemoriesApiHandler({
      memoryService: {
        async readArchivedMemories() {
          throw new MemoryDomainError(code, "private user detail");
        },
      },
    } as never);
    const { result, response } = responseRecorder();

    await handler(
      { webUserId: "user-a" } as Request,
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
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private user detail/,
    );
  });
}
