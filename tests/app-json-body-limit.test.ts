import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

const USER_ID = "00000000-0000-4000-8000-000000000099";

function configureEnvironment(): void {
  Object.assign(process.env, {
    MCP_USER_ID: USER_ID,
    MCP_SERVER_URL: "https://mcp.example.test",
    AUTH0_ISSUER: "https://issuer.example.test/",
    AUTH0_AUDIENCE: "https://mcp.example.test/mcp",
    AUTH0_JWKS_URI: "https://issuer.example.test/.well-known/jwks.json",
    AUTH0_REQUIRED_SCOPE: "mcp:access",
    AUTH0_ALLOWED_SUBJECT: "allowed-subject",
    WEB_APP_ORIGIN: "https://web.example.test",
    WEB_AUTH0_AUDIENCE: "https://web.example.test/api",
    WEB_AUTH0_REQUIRED_SCOPE: "web:access",
  });
}

async function withApp(callback: (baseUrl: string, calls: string[]) => Promise<void>): Promise<void> {
  configureEnvironment();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { createApp } = await import("../src/app/create-app.js");
    const calls: string[] = [];
    const app = createApp({
      verifyAccessToken: async () => ({ subject: "allowed-subject", issuer: "https://issuer.example.test/", audience: [], scopes: ["mcp:access"] }),
      verifyWebAccessToken: async () => ({ subject: "allowed-subject", issuer: "https://issuer.example.test/", audience: [], scopes: ["web:access"] }),
      webMemoryService: {
        async createMemory(input: { content: string }) { calls.push(input.content); },
      } as never,
      webDiaryService: {} as never,
      webTaskService: {} as never,
      webSystemService: {} as never,
      toyService: {} as never,
      webGlobalSearchService: {} as never,
      webTodoService: {} as never,
      webExportService: {} as never,
      webImportService: {} as never,
      webUniverseService: {} as never,
      webConversationImportService: {
        async preview(stream: AsyncIterable<Uint8Array>, filename: string) {
          let bytes = 0;
          for await (const chunk of stream) bytes += chunk.length;
          calls.push(`${filename}:${bytes}`);
          return {
            import_run_id: "run",
            source_id: "source",
            provider: "chatgpt",
            parser_version: "chatgpt-v1",
            filename,
            raw_sha256: "a".repeat(64),
            raw_bytes: bytes,
            source_reused: false,
            already_executed: false,
            preview_fingerprint: "b".repeat(64),
            summary: {
              conversations: { create: 0, update: 0, unchanged: 0, stale: 0 },
              messages: { create: 0, update: 0, unchanged: 0, stale: 0, path_changed: 0 },
            },
            warning_count: 0,
            warning_codes: {},
          };
        },
      } as never,
    });
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address() as AddressInfo;
    try {
      await callback(`http://127.0.0.1:${address.port}`, calls);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

test("the app JSON parser accepts a 100k CJK Memory body", async () => {
  await withApp(async (baseUrl, calls) => {
    const content = "蕾".repeat(100_000);
    const response = await fetch(`${baseUrl}/api/v1/memory`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ category: "goal", key: "long", content, tags: [], author: "L" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [content]);
  });
});

test("the app JSON parser remains bounded above 1mb", async () => {
  await withApp(async (baseUrl, calls) => {
    const content = "蕾".repeat(400_000);
    const response = await fetch(`${baseUrl}/api/v1/memory`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ category: "goal", key: "too-large", content, tags: [], author: "L" }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(calls, []);
  });
});


test("large Conversation octet-stream uploads bypass the global 1mb JSON parser", async () => {
  await withApp(async (baseUrl, calls) => {
    const body = new Uint8Array(2 * 1024 * 1024);
    const response = await fetch(`${baseUrl}/api/v1/conversations/import/preview`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/octet-stream",
        "x-leilei-filename": "conversations.json",
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [`conversations.json:${body.length}`]);
  });
});
