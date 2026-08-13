import assert from "node:assert/strict";
import test from "node:test";
import { NotionCommentClient } from "../src/domains/notion/notion-comment-client.js";
import { NotionTransport } from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("NotionCommentClient creates page/block/discussion comments and updates by id", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return jsonResponse({ object: "comment", id: "comment-id" });
  };
  const client = new NotionCommentClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  await client.createComment({ parent: { page_id: "page" }, markdown: "hello" });
  await client.createComment({ discussion_id: "discussion", markdown: "reply" });
  await client.updateComment("comment id", { markdown: "updated" });

  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.notion.com/v1/comments", "POST"],
    ["https://api.notion.com/v1/comments", "POST"],
    ["https://api.notion.com/v1/comments/comment%20id", "PATCH"],
  ]);
  assert.deepEqual(calls[1]?.body, { discussion_id: "discussion", markdown: "reply" });
});
