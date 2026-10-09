import assert from "node:assert/strict";
import test from "node:test";
import {
  memoryDay,
  memoryLocalTime,
  memoryTimestamp,
  loadMemoryDay,
  saveMemory,
} from "../web/src/pages/memory-api.js";
import { WebApiError } from "../web/src/api/web-api-error.js";

test("Memory uses Beijing days, explicit null and lossless unchanged timestamps", () => {
  assert.equal(memoryDay("2026-10-08T16:10:20.123Z"), "2026-10-09");
  assert.equal(memoryDay(null), null);
  assert.equal(
    memoryLocalTime("2026-10-08T16:10:20.123Z"),
    "2026-10-09T00:10:20.123",
  );
  assert.equal(
    memoryTimestamp("2026-10-09T00:10:20.123"),
    "2026-10-08T16:10:20.123Z",
  );
  assert.equal(memoryTimestamp(""), null);
});
test("daily read preserves cursor pagination and cancellation", async () => {
  const calls: string[] = [];
  const signal = new AbortController().signal;
  const api = {
    async request(path: string, init?: RequestInit) {
      calls.push(path);
      assert.equal(init?.signal, signal);
      return {
        data: {
          items: [{ id: String(calls.length) }],
          nextCursor: calls.length === 1 ? "page+2" : null,
        },
      };
    },
  } as any;
  assert.equal((await loadMemoryDay(api, "2026-10-09", signal)).length, 2);
  assert.match(calls[1]!, /cursor=page%2B2/);
});
test("conflict reads latest but never retries or overwrites the draft", async () => {
  const calls: any[] = [];
  const latest = { id: "a", text: "latest", contentVersion: "v2" };
  const api = {
    async request(path: string, init?: RequestInit) {
      calls.push({ path, init });
      if (init?.method === "PATCH")
        throw new WebApiError(409, "MIND_CONFLICT", "Conflict");
      return { data: latest };
    },
  } as any;
  const result = await saveMemory(
    api,
    { id: "a", contentVersion: "v1" } as any,
    "draft",
    null,
  );
  assert.deepEqual(result, { status: "conflict", latest });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    expected_version: "v1",
    text: "draft",
    occurred_at: null,
  });
});
test("conflict read failure remains a conflict and never retries the write", async () => {
  let calls = 0;
  const api = {
    async request(_path: string, init?: RequestInit) {
      calls++;
      if (init?.method === "PATCH")
        throw new WebApiError(409, "MIND_CONFLICT", "Conflict");
      throw new Error("offline");
    },
  } as any;
  assert.deepEqual(
    await saveMemory(
      api,
      { id: "a", contentVersion: "v1" } as any,
      "draft",
      null,
    ),
    { status: "conflict", latest: null },
  );
  assert.equal(calls, 2);
});
test("search undated flag and cursor remain in the same query context", async () => {
  const { searchMemory } = await import("../web/src/pages/memory-api.js");
  const api = {
    async request(path: string) {
      assert.equal(path, "/mind/search?limit=50&undated=true&cursor=a%2Bb");
      return { data: { items: [], nextCursor: null } };
    },
  } as any;
  assert.deepEqual(await searchMemory(api, true, "a+b"), {
    items: [],
    nextCursor: null,
  });
});
test("text-only edits omit unchanged event time and preserve temporal provenance", async () => {
  let body: any;
  const item = {
    id: "a",
    text: "old",
    occurredAt: "2026-10-08T00:00:00.000Z",
    contentVersion: "v1",
  } as any;
  const api = {
    async request(_path: string, init: RequestInit) {
      body = JSON.parse(init.body as string);
      return { data: item };
    },
  } as any;
  await saveMemory(api, item, "changed", item.occurredAt);
  assert.deepEqual(body, { expected_version: "v1", text: "changed" });
  await saveMemory(api, item, "old", null);
  assert.deepEqual(body, { expected_version: "v1", occurred_at: null });
});

test("default day discovery includes Memory when Todo and Diary dates are unavailable", async () => {
  const { resolveDaySpaceDefaultDate } =
    await import("../web/src/pages/day-space-data.js");
  assert.deepEqual(
    resolveDaySpaceDefaultDate(
      {
        todo: { status: "error" },
        diary: { status: "error" },
        memory: { status: "success", dates: ["2026-10-07", "2026-10-09"] },
      },
      "2026-10-08",
    ),
    { status: "ready", date: "2026-10-09", discoveryIncomplete: true },
  );
});

test("complete Memory list keeps filters on every cursor page and deduplicates records", async () => {
  const { loadMemoryList } = await import("../web/src/pages/memory-api.js");
  const calls: string[] = [];
  const signal = new AbortController().signal;
  const api = {
    request: async (path: string, init: RequestInit) => {
      calls.push(path);
      assert.equal(init.signal, signal);
      const q = new URL(path, "http://local").searchParams;
      assert.equal(q.get("query"), "needle");
      assert.equal(q.get("date_from"), "2026-10-01");
      assert.equal(q.get("date_to"), "2026-10-31");
      return {
        data: {
          items:
            calls.length === 1
              ? [{ id: "a", snippet: "old" }]
              : [{ id: "a", snippet: "latest" }, { id: "b" }],
          nextCursor: calls.length === 1 ? "page+2" : null,
        },
      };
    },
  } as any;
  assert.deepEqual(
    await loadMemoryList(
      api,
      { query: "needle", dateFrom: "2026-10-01", dateTo: "2026-10-31" },
      signal,
    ),
    [{ id: "a", snippet: "latest" }, { id: "b" }],
  );
  assert.equal(calls.length, 2);
});

test("complete list rejects cursor cycles and stops before another page after cancellation", async () => {
  const { loadMemoryList } = await import("../web/src/pages/memory-api.js");
  let calls = 0;
  const api = {
    request: async () => {
      calls++;
      return { data: { items: [], nextCursor: "same" } };
    },
  } as any;
  await assert.rejects(loadMemoryList(api, {}), /Repeated Memory cursor/);
  assert.equal(calls, 2);
  const abort = new AbortController();
  calls = 0;
  await assert.rejects(
    loadMemoryList(
      {
        request: async () => {
          calls++;
          abort.abort();
          return { data: { items: [], nextCursor: "next" } };
        },
      } as any,
      {},
      abort.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});

 test("object undated filter preserves keyword and cursor while excluding date bounds", async () => {
  const {loadMemoryList} = await import("../web/src/pages/memory-api.js");
  const calls: string[] = [];
  const api = {async request(path: string) {
    calls.push(path);
    const params = new URL(path, "http://localhost").searchParams;
    assert.equal(params.get("undated"), "true");
    assert.equal(params.get("query"), "sample");
    assert.equal(params.has("date_from"), false);
    assert.equal(params.has("date_to"), false);
    return {data: {items: [], nextCursor: calls.length === 1 ? "next+page" : null}};
  }} as any;
  await loadMemoryList(api, {query:" sample ",undated:true,dateFrom:"2026-10-01",dateTo:"2026-10-09"} as any);
  assert.equal(calls.length,2);
  assert.equal(new URL(calls[1]!,"http://localhost").searchParams.get("cursor"),"next+page");
});
