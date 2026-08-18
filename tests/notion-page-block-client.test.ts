import assert from "node:assert/strict";
import test from "node:test";
import { NotionPageBlockClient } from "../src/domains/notion/notion-page-block-client.js";
import { NotionTransport } from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("NotionPageBlockClient uses fixed page and block endpoint templates", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return jsonResponse({ object: "ok", id: "result-id" });
  };
  const client = new NotionPageBlockClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  await client.createPage({ parent: { type: "workspace", workspace: true }, properties: {} });
  await client.updatePage("page id", { in_trash: true });
  await client.movePage("page id", { type: "page_id", page_id: "parent-id" });
  await client.updatePageMarkdown("page id", { type: "insert_content", content: "hello" });
  await client.appendBlockChildren("block id", {
    children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }],
    position: { type: "end" },
  });
  await client.updateBlock("block id", { in_trash: false });
  await client.deleteBlock("block id");

  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.notion.com/v1/pages", "POST"],
    ["https://api.notion.com/v1/pages/page%20id", "PATCH"],
    ["https://api.notion.com/v1/pages/page%20id/move", "POST"],
    ["https://api.notion.com/v1/pages/page%20id/markdown", "PATCH"],
    ["https://api.notion.com/v1/blocks/block%20id/children", "PATCH"],
    ["https://api.notion.com/v1/blocks/block%20id", "PATCH"],
    ["https://api.notion.com/v1/blocks/block%20id", "DELETE"],
  ]);
  assert.deepEqual(calls[2]?.body, {
    parent: { type: "page_id", page_id: "parent-id" },
  });
  assert.deepEqual(calls[4]?.body, {
    children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [] } }],
    position: { type: "end" },
  });
});

test("page trash and restore are plain update payloads with no confirmation gate", async () => {
  const bodies: unknown[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
    return jsonResponse({ object: "page", id: "p" });
  };
  const client = new NotionPageBlockClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  await client.updatePage("p", { in_trash: true });
  await client.updatePage("p", { in_trash: false });

  assert.deepEqual(bodies, [{ in_trash: true }, { in_trash: false }]);
});
