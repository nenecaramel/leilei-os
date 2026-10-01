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
      webDiaryService: {
        async createWebDiary(input: { content: string }) { calls.push(input.content); return { id: "diary-1", ...input }; },
      } as never,
      webSystemService: {} as never,
      toyService: {} as never,
      webGlobalSearchService: {} as never,
      webTodoService: {} as never,
      webExportService: {} as never,
      webImportService: {} as never,
      webUniverseService: {} as never,

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

test("the app JSON parser accepts a 100k CJK Diary body", async () => {
  await withApp(async (baseUrl, calls) => {
    const content = "蕾".repeat(100_000);
    const response = await fetch(`${baseUrl}/api/v1/diary`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ title: "long", date: "2026-10-01", content, tags: [], author: "L" }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(calls, [content]);
  });
});

test("the app JSON parser remains bounded above 1mb", async () => {
  await withApp(async (baseUrl, calls) => {
    const content = "蕾".repeat(400_000);
    const response = await fetch(`${baseUrl}/api/v1/diary`, {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ category: "goal", key: "too-large", content, tags: [], author: "L" }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(calls, []);
  });
});
