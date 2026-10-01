import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { HealthSyncResult } from "../src/domains/health-v2/health-types.js";
import { HealthService } from "../src/domains/health-v2/health-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000081";
const HEALTH_KEY = "h".repeat(64);
const NOW = new Date("2026-09-06T04:00:00.000Z");

type CapturedEvent = {
  event: string;
  fields?: Record<string, unknown>;
};

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
    LEILEI_HEALTH_SYNC_KEY: HEALTH_KEY,
    LEILEI_HEALTH_SYNC_USER_ID: USER_ID,
  });
}

async function withApp(
  options: {
    healthSyncService?: {
      syncDaily(userId: string, input: unknown): Promise<HealthSyncResult>;
    };
    databaseReady?: boolean;
  },
  callback: (baseUrl: string, calls: unknown[], events: CapturedEvent[]) => Promise<void>,
): Promise<void> {
  configureEnvironment();
  const { createApp } = await import("../src/app/create-app.js");
  const calls: unknown[] = [];
  const events: CapturedEvent[] = [];
  const healthSyncService = options.healthSyncService ?? {
    async syncDaily(userId: string, input: unknown): Promise<HealthSyncResult> {
      calls.push({ userId, input });
      return {
        created: calls.length === 1,
        summary: {
          date: "2026-09-06",
          steps: 6842,
          menstruating: false,
          periodStartDate: "2026-09-04",
          cycleDay: 3,
          updatedAt: NOW,
        },
      };
    },
  };
  const app = createApp({
    logger: {
      debug(event: string, fields?: Record<string, unknown>) { events.push({ event, fields }); },
      info(event: string, fields?: Record<string, unknown>) { events.push({ event, fields }); },
      warn(event: string, fields?: Record<string, unknown>) { events.push({ event, fields }); },
      error(event: string, fields?: Record<string, unknown>) { events.push({ event, fields }); },
    } as never,
    databaseReadinessProbe: async () => {
      if (options.databaseReady === false) throw new Error("private database failure");
    },
    verifyAccessToken: async () => ({ subject: "allowed-subject", issuer: "https://issuer.example.test/", audience: [], scopes: ["mcp:access"] }),
    verifyWebAccessToken: async () => ({ subject: "allowed-subject", issuer: "https://issuer.example.test/", audience: [], scopes: ["web:access"] }),
    webMemoryService: {} as never,
    webDiaryService: {} as never,
    webTaskService: {} as never,
    webSystemService: {} as never,
    toyService: {} as never,
    webGlobalSearchService: {} as never,
    webTodoService: {} as never,
    webExportService: {} as never,
    webImportService: {} as never,
    webUniverseService: {} as never,
    healthSyncService: healthSyncService as never,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`, calls, events);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function syncRequest(
  baseUrl: string,
  body: unknown,
  key: string | null = HEALTH_KEY,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/health-sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key === null ? {} : { "x-leilei-health-sync-key": key }),
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  date: "2026-09-06",
  steps: 6842,
  menstruation_dates: ["2026-09-04", "2026-09-05"],
};

test("Health Shortcut sync has dedicated fail-closed key authentication", async () => {
  const { createHealthSyncAuthMiddleware } = await import("../src/web-api/health-sync-auth.js");
  const express = (await import("express")).default;

  for (const configuration of [
    { key: undefined, userId: USER_ID },
    { key: HEALTH_KEY, userId: undefined },
  ]) {
    const app = express();
    app.post("/sync", createHealthSyncAuthMiddleware(configuration.key, configuration.userId), (_request, response) => response.sendStatus(204));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/sync`, { method: "POST" });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        success: false,
        error: { code: "HEALTH_SYNC_UNAVAILABLE", message: "Health sync is unavailable." },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }

  await withApp({}, async (baseUrl, calls) => {
    for (const invalidKey of [null, "wrong".repeat(16)]) {
      const response = await syncRequest(baseUrl, VALID_BODY, invalidKey);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Health sync authentication failed." },
      });
    }
    assert.deepEqual(calls, []);
  });
});

test("Health Shortcut sync validates a strict body and returns normalized create/update summaries", async () => {
  await withApp({}, async (baseUrl, calls) => {
    for (const body of [
      { ...VALID_BODY, extra: true },
      { ...VALID_BODY, steps: -1 },
      { ...VALID_BODY, date: "2026-09-7" },
      { ...VALID_BODY, menstruation_dates: Array.from({ length: 61 }, () => "2026-09-06") },
    ]) {
      const response = await syncRequest(baseUrl, body);
      assert.equal(response.status, 400);
    }
    assert.deepEqual(calls, []);

    const created = await syncRequest(baseUrl, VALID_BODY);
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), {
      success: true,
      data: {
        date: "2026-09-06",
        steps: 6842,
        menstruating: false,
        period_start_date: "2026-09-04",
        cycle_day: 3,
        updated_at: "2026-09-06T04:00:00.000Z",
      },
    });

    const updated = await syncRequest(baseUrl, VALID_BODY);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json() as { success: boolean }).success, true);
    assert.equal(calls.length, 2);
  });
});

test("Health Shortcut sync accepts the exact 60-day menstruation boundary and rejects older dates", async () => {
  const now = new Date("2026-10-01T04:00:00.000Z");
  const service = new HealthService({
    async upsertDaily(_userId: string, summary) {
      return {
        created: true,
        summary: {
          ...summary,
          updatedAt: now,
        },
      };
    },
  } as never, () => now);

  await withApp({
    healthSyncService: service,
  }, async (baseUrl) => {
    const boundary = await syncRequest(baseUrl, {
      date: "2026-10-01",
      steps: 319,
      menstruation_dates: ["2026-08-02"],
    });
    assert.equal(boundary.status, 200);
    assert.equal(
      (await boundary.json() as { success: boolean }).success,
      true,
    );

    const tooOld = await syncRequest(baseUrl, {
      date: "2026-10-01",
      steps: 319,
      menstruation_dates: ["2026-08-01"],
    });
    assert.equal(tooOld.status, 400);
    assert.deepEqual(await tooOld.json(), {
      success: false,
      error: {
        code: "INVALID_HEALTH_REQUEST",
        message: "The Health sync request is invalid.",
      },
    });
  });
});

test("Health Shortcut sync is outside Auth0, readiness-gated, and does not restore retired Health routes", async () => {
  await withApp({ databaseReady: false }, async (baseUrl, calls) => {
    const unavailable = await syncRequest(baseUrl, VALID_BODY);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json() as { error: { code: string } }).error.code, "DATABASE_UNAVAILABLE");
    assert.deepEqual(calls, []);

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      success: true,
      data: { service: "leilei-os", status: "ok" },
    });

    await withApp({}, async (readyBaseUrl) => {
      const retired = await fetch(`${readyBaseUrl}/api/v1/health`, {
        headers: { authorization: "Bearer web-token" },
      });
      assert.equal(retired.status, 404);
    });
  });
});

test("Health Shortcut sync keeps its key and Health payload out of observability output", async () => {
  await withApp({}, async (baseUrl, _calls, events) => {
    const response = await syncRequest(baseUrl, VALID_BODY);
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes(HEALTH_KEY));
    assert.ok(!serialized.includes("6842"));
    assert.ok(!serialized.includes("2026-09-04"));
  });
});
