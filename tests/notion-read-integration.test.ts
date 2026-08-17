import assert from "node:assert/strict";
import test from "node:test";
import {
  NotionIntegration,
  NotionIntegrationError,
  parseNotionPageReference,
} from "../src/domains/notion/notion-read-integration.js";

const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATABASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DATA_SOURCE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createIntegration(responses: Record<string, unknown>) {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace(/^\/v1/, "")}${url.search}`;
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const response = responses[path] ?? responses[url.pathname];
    return response instanceof Response ? response : jsonResponse(response ?? {});
  };
  return {
    integration: new NotionIntegration("test-token-1234567890123456", fetchImpl),
    calls,
  };
}

test("parseNotionPageReference accepts stable IDs and safe Notion URLs", () => {
  assert.equal(parseNotionPageReference(PAGE_ID), PAGE_ID);
  assert.equal(parseNotionPageReference(PAGE_ID.replaceAll("-", "").toUpperCase()), PAGE_ID);
  assert.equal(
    parseNotionPageReference(`https://www.notion.so/Project-${PAGE_ID.replaceAll("-", "")}`),
    PAGE_ID,
  );
  assert.equal(
    parseNotionPageReference(`https://app.notion.com/workspace/${PAGE_ID.replaceAll("-", "")}`),
    PAGE_ID,
  );
  assert.equal(
    parseNotionPageReference(`https://leilei.notion.site/Project-${PAGE_ID.replaceAll("-", "")}`),
    PAGE_ID,
  );
  assert.throws(
    () => parseNotionPageReference("https://evil.example/page/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    (error: unknown) => error instanceof NotionIntegrationError && error.code === "INVALID_INPUT",
  );
});

test("connection discovery normalizes identity, workspace, and read capabilities without credentials", async () => {
  const { integration, calls } = createIntegration({
    "/users/me": {
      object: "user",
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Leilei Bot",
      type: "bot",
      bot: {
        workspace_name: "Leilei Workspace",
        workspace_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      },
    },
  });

  const result = await integration.getConnection();
  assert.deepEqual(result, {
    provider: "notion",
    connection: {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      name: "Leilei Bot",
      type: "bot",
    },
    workspace: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Leilei Workspace",
    },
    capabilities: ["page.read", "database.read", "data_source.read", "data_source.query"],
  });
  assert.equal(JSON.stringify(result).includes("test-token-1234567890123456"), false);
  assert.deepEqual(calls, [{ path: "/users/me", method: "GET", body: undefined }]);
});

test("database and data source reads preserve stable IDs and normalize schema", async () => {
  const { integration, calls } = createIntegration({
    [`/databases/${DATABASE_ID}`]: {
      object: "database",
      id: DATABASE_ID,
      url: "https://www.notion.so/database",
      created_time: "2026-08-01T00:00:00.000Z",
      last_edited_time: "2026-08-02T00:00:00.000Z",
      title: [{ plain_text: "Projects" }],
      data_sources: [{ id: DATA_SOURCE_ID, name: "Projects" }],
    },
    [`/data_sources/${DATA_SOURCE_ID}`]: {
      object: "data_source",
      id: DATA_SOURCE_ID,
      url: "https://www.notion.so/data-source",
      created_time: "2026-08-03T00:00:00.000Z",
      last_edited_time: "2026-08-04T00:00:00.000Z",
      title: [{ plain_text: "Projects source" }],
      parent: { type: "database_id", database_id: DATABASE_ID },
      properties: {
        Name: { id: "title", type: "title", title: {} },
        Status: { id: "status", type: "status", status: {} },
      },
    },
  });

  assert.deepEqual(await integration.readDatabase(DATABASE_ID), {
    id: DATABASE_ID,
    url: "https://www.notion.so/database",
    title: "Projects",
    created_time: "2026-08-01T00:00:00.000Z",
    last_edited_time: "2026-08-02T00:00:00.000Z",
    data_sources: [{ id: DATA_SOURCE_ID, name: "Projects" }],
    schema: [],
  });
  assert.deepEqual(await integration.readDataSource(DATA_SOURCE_ID), {
    id: DATA_SOURCE_ID,
    url: "https://www.notion.so/data-source",
    title: "Projects source",
    created_time: "2026-08-03T00:00:00.000Z",
    last_edited_time: "2026-08-04T00:00:00.000Z",
    parent_database_id: DATABASE_ID,
    schema: [
      { id: "title", name: "Name", type: "title" },
      { id: "status", name: "Status", type: "status" },
    ],
  });
  assert.deepEqual(calls.map(({ path, method }) => ({ path, method })), [
    { path: `/databases/${DATABASE_ID}`, method: "GET" },
    { path: `/data_sources/${DATA_SOURCE_ID}`, method: "GET" },
  ]);
});

test("data source query binds structured filters, limit, and cursors and normalizes page results", async () => {
  const { integration, calls } = createIntegration({
    [`/data_sources/${DATA_SOURCE_ID}/query`]: {
      object: "list",
      has_more: true,
      next_cursor: "next-page",
      results: [{
        object: "page",
        id: PAGE_ID,
        url: "https://www.notion.so/project",
        created_time: "2026-08-17T00:00:00.000Z",
        last_edited_time: "2026-08-17T01:00:00.000Z",
        properties: {
          Name: { id: "title", type: "title", title: [{ plain_text: "Project" }] },
          Done: { id: "done", type: "checkbox", checkbox: true },
        },
      }],
    },
  });

  const result = await integration.queryDataSource({
    dataSourceId: DATA_SOURCE_ID,
    limit: 17,
    cursor: "cursor-1",
    filter: { property: "Done", checkbox: { equals: true } },
    sorts: [{ property: "Name", direction: "ascending" }],
  });
  assert.deepEqual(result.metadata, { count: 1, has_more: true, next_cursor: "next-page" });
  assert.deepEqual(result.results[0], {
    id: PAGE_ID,
    url: "https://www.notion.so/project",
    title: "Project",
    created_time: "2026-08-17T00:00:00.000Z",
    last_edited_time: "2026-08-17T01:00:00.000Z",
    properties: {
      Name: { id: "title", type: "title", value: "Project" },
      Done: { id: "done", type: "checkbox", value: true },
    },
  });
  assert.deepEqual(calls[0], {
    path: `/data_sources/${DATA_SOURCE_ID}/query`,
    method: "POST",
    body: {
      page_size: 17,
      result_type: "page",
      start_cursor: "cursor-1",
      filter: { property: "Done", checkbox: { equals: true } },
      sorts: [{ property: "Name", direction: "ascending" }],
    },
  });
});

test("data source query rejects malformed list envelopes and non-page results", async () => {
  const malformedResponses = [
    { results: [], has_more: false, next_cursor: null },
    { object: "list", results: {}, has_more: false, next_cursor: null },
    { object: "list", results: [], has_more: "false", next_cursor: null },
    { object: "list", results: [], has_more: false },
    { object: "list", results: [], has_more: true, next_cursor: null },
    { object: "list", results: [{ object: "data_source", id: DATA_SOURCE_ID }], has_more: false, next_cursor: null },
  ];
  for (const response of malformedResponses) {
    const { integration } = createIntegration({ [`/data_sources/${DATA_SOURCE_ID}/query`]: response });
    await assert.rejects(
      () => integration.queryDataSource({ dataSourceId: DATA_SOURCE_ID }),
      (error: unknown) => error instanceof NotionIntegrationError && error.code === "MALFORMED_RESPONSE",
    );
  }
});

test("unsupported page property types retain explicit type evidence instead of becoming null", async () => {
  const { integration } = createIntegration({
    [`/data_sources/${DATA_SOURCE_ID}/query`]: {
      object: "list",
      results: [{
        object: "page",
        id: PAGE_ID,
        properties: {
          Formula: { id: "formula", type: "formula", formula: { type: "number", number: 42 } },
          Rollup: { id: "rollup", type: "rollup", rollup: { type: "number", number: 3 } },
          Files: { id: "files", type: "files", files: [{ name: "brief.pdf", type: "external", external: { url: "https://files.example/brief.pdf" } }] },
        },
      }],
      has_more: false,
      next_cursor: null,
    },
  });
  const result = await integration.queryDataSource({ dataSourceId: DATA_SOURCE_ID });
  assert.deepEqual(result.results[0]?.properties, {
    Formula: { id: "formula", type: "formula", value: { unsupported: true, provider_type: "formula" } },
    Rollup: { id: "rollup", type: "rollup", value: { unsupported: true, provider_type: "rollup" } },
    Files: { id: "files", type: "files", value: { unsupported: true, provider_type: "files" } },
  });
});

test("invalid input and malformed provider responses fail closed", async () => {
  const { integration } = createIntegration({
    "/users/me": { object: "unexpected" },
  });
  await assert.rejects(
    () => integration.getConnection(),
    (error: unknown) => error instanceof NotionIntegrationError && error.code === "MALFORMED_RESPONSE",
  );
  await assert.rejects(
    () => integration.queryDataSource({ dataSourceId: DATA_SOURCE_ID, limit: 101 }),
    (error: unknown) => error instanceof NotionIntegrationError && error.code === "INVALID_INPUT",
  );
  await assert.rejects(
    () => integration.queryDataSource({ dataSourceId: DATA_SOURCE_ID, filter: "SELECT *" as never }),
    (error: unknown) => error instanceof NotionIntegrationError && error.code === "INVALID_INPUT",
  );
});

test("Notion transport error categories remain safe for advanced reads", async () => {
  for (const [status, code] of [[401, "AUTHENTICATION_FAILED"], [403, "ACCESS_DENIED"], [404, "NOT_FOUND"], [429, "RATE_LIMITED"], [503, "UPSTREAM"]] as const) {
    const { integration } = createIntegration({ [`/databases/${DATABASE_ID}`]: new Response("private upstream secret", { status }) });
    await assert.rejects(
      () => integration.readDatabase(DATABASE_ID),
      (error: unknown) => {
        assert.ok(error instanceof NotionIntegrationError);
        assert.equal(error.code, code);
        assert.equal(error.message.includes("private upstream secret"), false);
        return true;
      },
    );
  }
});
