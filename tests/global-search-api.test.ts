import assert from "node:assert/strict";
import type {
  Request,
  Response,
} from "express";
import test from "node:test";
import {
  createGlobalSearchApiHandler,
} from "../src/web-api/global-search-router.js";
import type {
  GlobalSearchResult,
} from "../src/domains/global-search/global-search-service.js";

const result: GlobalSearchResult = {
  results: [],
  metadata: {
    count: 0,
    has_more: false,
    next_cursor: null,
    searched_modules: [
      "diary",
      "todo",
      "universe",
    ],
    searched_scope: "active",
    searched_author: null,
  },
};

function recorder() {
  const state: {
    status: number;
    body?: unknown;
    headers: Record<string, string>;
  } = {
    status: 200,
    headers: {},
  };
  const response = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
  } as unknown as Response;
  return { state, response };
}

test("Web global search uses authenticated identity and active modules", async () => {
  const calls: unknown[] = [];
  const handler =
    createGlobalSearchApiHandler({
      globalSearchService: {
        async search(input) {
          calls.push(input);
          return result;
        },
      },
    });
  const { state, response } = recorder();

  await handler(
    {
      webUserId: "user-a",
      query: {
        query: "计划",
        modules: "diary,todo",
        scope: "all",
        author: "C",
        limit: "5",
      },
    } as unknown as Request,
    response,
    () => {},
  );

  assert.equal(state.status, 200);
  assert.equal(
    state.headers["Cache-Control"],
    "private, no-store",
  );
  assert.equal(
    state.headers.Pragma,
    "no-cache",
  );
  assert.deepEqual(calls, [{
    userId: "user-a",
    query: "计划",
    modules: ["diary", "todo"],
    scope: "all",
    mode: undefined,
    author: "C",
    date_from: undefined,
    date_to: undefined,
    limit: 5,
    cursor: undefined,
  }]);
});

test("Web global search forwards C author records unchanged", async () => {
  const cResult: GlobalSearchResult = {
    results: [{
      entity_type: "diary",
      entity_id:
        "00000000-0000-4000-8000-000000000001",
      stable_name: "C record",
      snippet: "C record",
      matched_field: "content",
      match_reason: "field_match",
      lifecycle_status: "active",
      business_time:
        "2026-08-01T00:00:00.000Z",
      time_basis: "diary_date",
      updated_at:
        "2026-08-01T00:00:00.000Z",
      detail_tool: "get_diary",
      detail_arguments: {
        id:
          "00000000-0000-4000-8000-000000000001",
        scope: "active",
      },
      author: "C",
    }],
    metadata: {
      count: 1,
      has_more: false,
      next_cursor: null,
      searched_modules: ["diary"],
      searched_scope: "active",
      searched_author: "C",
    },
  };

  const handler =
    createGlobalSearchApiHandler({
      globalSearchService: {
        async search() {
          return cResult;
        },
      },
    });
  const { state, response } = recorder();

  await handler(
    {
      webUserId: "user-a",
      query: {
        query: "C",
        modules: "diary",
      },
    } as unknown as Request,
    response,
    () => {},
  );

  assert.deepEqual(
    (state.body as {
      data: GlobalSearchResult;
    }).data.results[0]?.author,
    "C",
  );
});

test("Web global search rejects malformed module query geometry", async () => {
  const handler =
    createGlobalSearchApiHandler({
      globalSearchService: {
        async search() {
          throw new Error(
            "must not be called",
          );
        },
      },
    });

  for (const query of [
    { query: "计划", author: ["C"] },
    { query: "计划", modules: ["diary", 1] },
    { query: "计划", modules: "diary,,todo" },
    { query: "计划", modules: ["diary,todo"] },
  ]) {
    const { state, response } = recorder();
    await handler(
      {
        webUserId: "user-a",
        query,
      } as unknown as Request,
      response,
      () => {},
    );
    assert.equal(state.status, 400);
  }
});
