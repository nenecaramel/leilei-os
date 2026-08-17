import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionExplicitWriteError,
  NotionExplicitWriteService,
} from "../src/domains/notion/notion-explicit-write-service.js";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const DISCUSSION_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("page update performs fresh read, one explicit write, then fresh readback", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname });

    if (method === "PATCH") {
      return jsonResponse({ object: "page", id: PAGE_ID, properties: { Name: { type: "title", title: [] } } });
    }
    return jsonResponse({ object: "page", id: PAGE_ID, properties: { Name: { type: "title", title: [] } } });
  };

  const service = new NotionExplicitWriteService("secret", fetchImpl);
  const result = await service.updatePage(PAGE_ID, {
    properties: { Name: { title: [{ type: "text", text: { content: "Updated" } }] } },
  });

  assert.equal(result.verified, true);
  assert.equal(result.target_id, PAGE_ID);
  assert.deepEqual(calls, [
    { method: "GET", path: `/v1/pages/${PAGE_ID}` },
    { method: "PATCH", path: `/v1/pages/${PAGE_ID}` },
    { method: "GET", path: `/v1/pages/${PAGE_ID}` },
  ]);
});

test("uncertain page update performs readback and never retries the mutation", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  let patchCalls = 0;
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname });
    if (method === "PATCH") {
      patchCalls += 1;
      throw new TypeError("connection reset after send");
    }
    return jsonResponse({ object: "page", id: PAGE_ID, properties: {} });
  };

  const service = new NotionExplicitWriteService("secret", fetchImpl);
  await assert.rejects(
    () => service.updatePage(PAGE_ID, { properties: {} }),
    (error: unknown) => error instanceof NotionExplicitWriteError && error.code === "UNCERTAIN_WRITE",
  );

  assert.equal(patchCalls, 1);
  assert.deepEqual(calls, [
    { method: "GET", path: `/v1/pages/${PAGE_ID}` },
    { method: "PATCH", path: `/v1/pages/${PAGE_ID}` },
    { method: "GET", path: `/v1/pages/${PAGE_ID}` },
  ]);
});

test("page content update verifies the exact provider markdown with a fresh markdown readback", async () => {
  const calls: Array<{ method: string; path: string }> = [];
  let markdown = "# Before";
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    calls.push({ method, path: url.pathname });
    if (method === "PATCH") {
      markdown = "# After";
      return jsonResponse({ object: "page_markdown", id: PAGE_ID, markdown, truncated: false, unknown_block_ids: [] });
    }
    return jsonResponse({ object: "page_markdown", id: PAGE_ID, markdown, truncated: false, unknown_block_ids: [] });
  };

  const service = new NotionExplicitWriteService("secret", fetchImpl);
  const result = await service.updatePageContent(PAGE_ID, {
    type: "replace_content",
    replace_content: { new_str: "# After" },
  });

  assert.equal(result.verified, true);
  assert.deepEqual(calls, [
    { method: "GET", path: `/v1/pages/${PAGE_ID}/markdown` },
    { method: "PATCH", path: `/v1/pages/${PAGE_ID}/markdown` },
    { method: "GET", path: `/v1/pages/${PAGE_ID}/markdown` },
  ]);
});

test("comment reply fresh-reads the page, creates once, then retrieves the created comment", async () => {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });

    if (url.pathname === "/v1/comments" && method === "POST") {
      return jsonResponse({
        object: "comment",
        id: COMMENT_ID,
        discussion_id: DISCUSSION_ID,
        rich_text: [{ type: "text", plain_text: "Reply" }],
      });
    }
    if (url.pathname === `/v1/comments/${COMMENT_ID}`) {
      return jsonResponse({
        object: "comment",
        id: COMMENT_ID,
        discussion_id: DISCUSSION_ID,
        rich_text: [{ type: "text", plain_text: "Reply" }],
      });
    }
    return jsonResponse({ object: "page", id: PAGE_ID, properties: {} });
  };

  const service = new NotionExplicitWriteService("secret", fetchImpl);
  const result = await service.replyComment(PAGE_ID, DISCUSSION_ID, {
    rich_text: [{ type: "text", text: { content: "Reply" } }],
  });

  assert.equal(result.verified, true);
  assert.equal(result.target_id, COMMENT_ID);
  assert.deepEqual(calls.map(({ method, path }) => ({ method, path })), [
    { method: "GET", path: `/v1/pages/${PAGE_ID}` },
    { method: "POST", path: "/v1/comments" },
    { method: "GET", path: `/v1/comments/${COMMENT_ID}` },
  ]);
  assert.deepEqual(calls[1]?.body, {
    rich_text: [{ type: "text", text: { content: "Reply" } }],
    discussion_id: DISCUSSION_ID,
  });
});

test("destructive page update payloads are rejected before any provider call", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return jsonResponse({ object: "page", id: PAGE_ID });
  };
  const service = new NotionExplicitWriteService("secret", fetchImpl);

  await assert.rejects(
    () => service.updatePage(PAGE_ID, { in_trash: true }),
    (error: unknown) => error instanceof NotionExplicitWriteError && error.code === "INVALID_WRITE",
  );
  assert.equal(calls, 0);
});
