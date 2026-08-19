import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionApiError,
  NotionTransport,
} from "../src/domains/notion/notion-transport.js";
import {
  NotionReadClient,
  NotionReadError,
} from "../src/domains/notion/notion-read-client.js";
import {
  NotionExplicitWriteError,
  NotionExplicitWriteService,
} from "../src/domains/notion/notion-explicit-write-service.js";

const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hangingFetchUntilAbort(onAbort?: () => void): typeof fetch {
  return async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    const abort = () => {
      onAbort?.();
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function within<T>(promise: Promise<T>, milliseconds = 250): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("test outer timeout")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("Notion transport aborts a provider request at its request deadline", async () => {
  let aborted = false;
  const transport = new NotionTransport(
    "secret-notion-token",
    hangingFetchUntilAbort(() => {
      aborted = true;
    }),
    { requestTimeoutMs: 20 },
  );

  await assert.rejects(
    () => within(transport.requestJson("/users/me")),
    (error: unknown) =>
      error instanceof NotionApiError && error.code === "UPSTREAM",
  );
  assert.equal(aborted, true);
});

test("Notion page reads enforce one total operation deadline across pagination", async () => {
  let blockCalls = 0;
  let secondBlockRequestAborted = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === `https://api.notion.com/v1/pages/${PAGE_ID}`) {
      return jsonResponse({
        object: "page",
        id: PAGE_ID,
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-19T00:00:00.000Z",
        properties: {},
      });
    }
    if (url.includes(`/blocks/${PAGE_ID}/children`)) {
      blockCalls += 1;
      if (blockCalls === 1) {
        return jsonResponse({
          object: "list",
          type: "block",
          block: {},
          results: [{
            object: "block",
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            type: "paragraph",
            has_children: false,
            paragraph: { rich_text: [{ plain_text: "first" }] },
          }],
          has_more: true,
          next_cursor: "next-page",
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const abort = () => {
          secondBlockRequestAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new NotionReadClient(
    "secret-notion-token",
    fakeFetch,
    { requestTimeoutMs: 1_000, operationTimeoutMs: 40 },
  );

  await assert.rejects(
    () => within(client.readPage(PAGE_ID)),
    (error: unknown) =>
      error instanceof NotionReadError && error.code === "UPSTREAM",
  );
  assert.equal(blockCalls, 2);
  assert.equal(secondBlockRequestAborted, true);
});

test("a timed-out Notion mutation is read back once and never retried", async () => {
  let reads = 0;
  let writes = 0;
  let writeAborted = false;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === `https://api.notion.com/v1/pages/${PAGE_ID}` && init?.method === "PATCH") {
      writes += 1;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) return;
        const abort = () => {
          writeAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    if (url === `https://api.notion.com/v1/pages/${PAGE_ID}`) {
      reads += 1;
      return jsonResponse({ object: "page", id: PAGE_ID, properties: {} });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const service = new NotionExplicitWriteService(
    "secret-notion-token",
    fakeFetch,
    { requestTimeoutMs: 20 },
  );

  await assert.rejects(
    () => within(service.updatePage(PAGE_ID, { properties: {} })),
    (error: unknown) =>
      error instanceof NotionExplicitWriteError && error.code === "UNCERTAIN_WRITE",
  );
  assert.equal(writeAborted, true);
  assert.equal(writes, 1);
  assert.equal(reads, 2);
});
