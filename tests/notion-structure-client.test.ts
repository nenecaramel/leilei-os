import assert from "node:assert/strict";
import test from "node:test";
import { NotionStructureClient } from "../src/domains/notion/notion-structure-client.js";
import { NotionTransport } from "../src/domains/notion/notion-transport.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("NotionStructureClient uses fixed database, data source, and view endpoints", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return jsonResponse({ object: "ok", id: "result-id" });
  };
  const client = new NotionStructureClient(
    new NotionTransport("ntn_secret_123456789", fakeFetch),
  );

  await client.createDatabase({ parent: { type: "workspace", workspace: true }, title: [] });
  await client.updateDatabase("db id", { title: [{ type: "text" }] });
  await client.createDataSource({ parent: { type: "database_id", database_id: "db" }, properties: {} });
  await client.updateDataSource("source id", {
    properties: { Old: null },
    in_trash: true,
  });
  await client.createView({ data_source_id: "source", name: "All", type: "table" });
  await client.updateView("view id", {
    filter: null,
    sorts: null,
    configuration: { type: "table" },
  });

  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    ["https://api.notion.com/v1/databases", "POST"],
    ["https://api.notion.com/v1/databases/db%20id", "PATCH"],
    ["https://api.notion.com/v1/data_sources", "POST"],
    ["https://api.notion.com/v1/data_sources/source%20id", "PATCH"],
    ["https://api.notion.com/v1/views", "POST"],
    ["https://api.notion.com/v1/views/view%20id", "PATCH"],
  ]);
  assert.deepEqual(calls[3]?.body, {
    properties: { Old: null },
    in_trash: true,
  });
});
