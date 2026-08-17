import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionReadClient,
  NotionReadError,
} from "../src/domains/notion/notion-read-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("searchPages sends a page-only title search and maps safe page metadata", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return jsonResponse({
      object: "list",
      results: [
        {
          object: "page",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          url: "https://www.notion.so/example",
          last_edited_time: "2026-08-13T08:00:00.000Z",
          properties: {
            Name: {
              id: "title",
              type: "title",
              title: [{ type: "text", plain_text: "主线规划" }],
            },
          },
        },
      ],
      has_more: true,
      next_cursor: "next-search-cursor",
    });
  };

  const client = new NotionReadClient("secret-notion-token", fakeFetch);
  const result = await client.searchPages({
    query: "  主线规划  ",
    limit: 7,
    cursor: "search-cursor",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.notion.com/v1/search");
  assert.equal(calls[0]?.init?.method, "POST");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer secret-notion-token");
  assert.equal(headers.get("notion-version"), "2026-03-11");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    query: "主线规划",
    page_size: 7,
    start_cursor: "search-cursor",
    filter: { property: "object", value: "page" },
  });
  assert.deepEqual(result, {
    results: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "主线规划",
        url: "https://www.notion.so/example",
        last_edited_time: "2026-08-13T08:00:00.000Z",
      },
    ],
    metadata: {
      count: 1,
      has_more: true,
      next_cursor: "next-search-cursor",
    },
  });
});

test("readPage paginates blocks, traverses structural children, and does not expand child pages", async () => {
  const pageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const toggleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const childPageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url === `https://api.notion.com/v1/pages/${pageId}`) {
      return jsonResponse({
        object: "page",
        id: pageId,
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:30:00.000Z",
        properties: {
          title: {
            id: "title",
            type: "title",
            title: [{ type: "text", plain_text: "Main page" }],
          },
        },
      });
    }

    if (url === `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`) {
      return jsonResponse({
        object: "list",
        results: [
          {
            object: "block",
            id: "11111111-1111-4111-8111-111111111111",
            type: "heading_1",
            has_children: false,
            heading_1: { rich_text: [{ plain_text: "Heading" }] },
          },
          {
            object: "block",
            id: toggleId,
            type: "toggle",
            has_children: true,
            toggle: { rich_text: [{ plain_text: "Details" }] },
          },
          {
            object: "block",
            id: childPageId,
            type: "child_page",
            has_children: true,
            child_page: { title: "Nested page" },
          },
        ],
        has_more: true,
        next_cursor: "root-next",
      });
    }

    if (url === `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100&start_cursor=root-next`) {
      return jsonResponse({
        object: "list",
        results: [
          {
            object: "block",
            id: "22222222-2222-4222-8222-222222222222",
            type: "to_do",
            has_children: false,
            to_do: {
              checked: true,
              rich_text: [{ plain_text: "Ship it" }],
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    }

    if (url === `https://api.notion.com/v1/blocks/${toggleId}/children?page_size=100`) {
      return jsonResponse({
        object: "list",
        results: [
          {
            object: "block",
            id: "33333333-3333-4333-8333-333333333333",
            type: "bulleted_list_item",
            has_children: false,
            bulleted_list_item: { rich_text: [{ plain_text: "Nested item" }] },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const client = new NotionReadClient("secret-notion-token", fakeFetch);
  const result = await client.readPage(pageId);

  assert.deepEqual(result.page, {
    id: pageId,
    title: "Main page",
    url: "https://www.notion.so/main",
    last_edited_time: "2026-08-13T08:30:00.000Z",
  });
  assert.equal(result.block_count, 5);
  assert.equal(result.truncated, false);
  assert.match(result.content, /# Heading/);
  assert.match(result.content, /Details/);
  assert.match(result.content, /Nested item/);
  assert.match(result.content, /Child page: Nested page/);
  assert.match(result.content, /\[x\] Ship it/);
  assert.equal(
    calls.some((url) => url.includes(`/blocks/${childPageId}/children`)),
    false,
  );
});

test("Notion read failures map to stable error codes without exposing upstream bodies", async () => {
  const cases = [
    [401, "AUTHENTICATION_FAILED"],
    [403, "ACCESS_DENIED"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [500, "UPSTREAM"],
  ] as const;

  for (const [status, expectedCode] of cases) {
    const client = new NotionReadClient(
      "secret-notion-token",
      async () => new Response("sensitive upstream body", { status }),
    );
    await assert.rejects(
      () => client.searchPages({ query: "x" }),
      (error: unknown) => {
        assert.ok(error instanceof NotionReadError);
        assert.equal(error.code, expectedCode);
        assert.equal(error.message.includes("sensitive upstream body"), false);
        return true;
      },
    );
  }

  const unconfigured = new NotionReadClient(undefined, async () => jsonResponse({}));
  await assert.rejects(
    () => unconfigured.searchPages({ query: "x" }),
    (error: unknown) => {
      assert.ok(error instanceof NotionReadError);
      assert.equal(error.code, "NOT_CONFIGURED");
      return true;
    },
  );
});
