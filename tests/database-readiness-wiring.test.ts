import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AddressInfo } from "node:net";
import {
  RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS,
} from "../src/database/migration-readiness.js";

const createAppSource = readFileSync("src/app/create-app.ts", "utf8");
const clientSource = readFileSync("src/database/client.ts", "utf8");
const migrateSource = readFileSync("src/database/migrate.ts", "utf8");

const USER_ID = "00000000-0000-4000-8000-000000000001";

type CapturedEvent = {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  fields?: Record<string, unknown>;
};

function configuredEnvironment(): Record<string, string> {
  return {
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
  };
}

async function withConfiguredApp(
  probe: (() => Promise<unknown>) | undefined,
  callback: (baseUrl: string, events: CapturedEvent[], probeCalls: () => number) => Promise<void>,
): Promise<void> {
  const environment = configuredEnvironment();
  const keys = [...Object.keys(environment), "DATABASE_URL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  delete process.env.DATABASE_URL;

  try {
    const { createApp } = await import("../src/app/create-app.js");
    const events: CapturedEvent[] = [];
    let calls = 0;
    const app = createApp({
      logger: {
        debug: (event: string, fields?: Record<string, unknown>) => events.push({ level: "debug", event, fields }),
        info: (event: string, fields?: Record<string, unknown>) => events.push({ level: "info", event, fields }),
        warn: (event: string, fields?: Record<string, unknown>) => events.push({ level: "warn", event, fields }),
        error: (event: string, fields?: Record<string, unknown>) => events.push({ level: "error", event, fields }),
      } as never,
      databaseReadinessProbe: probe
        ? async () => {
            calls += 1;
            return probe();
          }
        : undefined,
      verifyAccessToken: async () => ({
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: [],
        scopes: ["mcp:access"],
      }),
      verifyWebAccessToken: async () => ({
        subject: "allowed-subject",
        issuer: "https://issuer.example.test/",
        audience: [],
        scopes: ["web:access"],
      }),
      webDiaryService: {} as never,
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
      await callback(`http://127.0.0.1:${address.port}`, events, () => calls);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("database-backed HTTP surfaces wait for readiness before business handlers", () => {
  assert.match(createAppSource, /createDatabaseReadinessGate/);
  assert.match(createAppSource, /dependencies\.databaseReadinessProbe/);
  assert.match(createAppSource, /databaseReadinessMiddleware/);
  assert.match(createAppSource, /\/api\/v1/);
  assert.match(createAppSource, /\/mcp/);
  assert.match(createAppSource, /\/internal\/mcp/);
});

test("runtime database pools release idle sockets for Railway serverless sleep", () => {
  assert.match(clientSource, /idle_timeout\s*:\s*\d+/);
});

test("runtime database resource owns the shared readiness probe", () => {
  assert.match(clientSource, /probe\s*:\s*\(\)\s*=>\s*client`select 1`/);
});

test("migration readiness uses bounded connection and idle timeouts", () => {
  assert.match(migrateSource, /connect_timeout\s*:\s*\d+/);
  assert.match(migrateSource, /idle_timeout\s*:\s*\d+/);
});

test("health remains DB-free while ready uses the shared readiness probe", async () => {
  let probeCalls = 0;
  await withConfiguredApp(
    async () => {
      probeCalls += 1;
    },
    async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), {
        success: true,
        data: { service: "leilei-os", status: "ok" },
      });
      assert.equal(probeCalls, 0);

      const ready = await fetch(`${baseUrl}/ready`);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), {
        success: true,
        data: { service: "leilei-os", status: "ready" },
      });
      assert.equal(probeCalls, 1);
    },
  );
});

test("ready returns the safe unavailable contract and structured failure fingerprint", async () => {
  const databaseError = Object.assign(new Error("private database password"), {
    name: "PostgresError",
    code: "28P01",
  });
  await withConfiguredApp(
    async () => {
      throw databaseError;
    },
    async (baseUrl, events, probeCalls) => {
      const ready = await fetch(`${baseUrl}/ready`);
      assert.equal(ready.status, 503);
      assert.deepEqual(await ready.json(), {
        success: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database is temporarily unavailable.",
        },
      });
      assert.equal(probeCalls(), 1);
      const failure = events.find((event) => event.event === "database_readiness_failed");
      assert.deepEqual(failure, {
        level: "error",
        event: "database_readiness_failed",
        fields: { name: "PostgresError", code: "28P01" },
      });
      assert.equal(JSON.stringify(events).includes("private database password"), false);
    },
  );
});

test("ready reports unconfigured readiness as unavailable without creating a probe", async () => {
  await withConfiguredApp(undefined, async (baseUrl, events, probeCalls) => {
    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 503);
    assert.deepEqual(await ready.json(), {
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database is temporarily unavailable.",
      },
    });
    assert.equal(probeCalls(), 0);
    assert.deepEqual(events.find((event) => event.event === "database_readiness_failed"), {
      level: "error",
      event: "database_readiness_failed",
      fields: { name: "UNAVAILABLE", code: "UNCONFIGURED" },
    });
  });
});

test("database readiness retry event contains only safe retry fields", async () => {
  let attempts = 0;
  const transient = Object.assign(new Error("private transient details"), {
    name: "PostgresError",
    code: "57P03",
  });
  await withConfiguredApp(
    async () => {
      attempts += 1;
      if (attempts === 1) throw transient;
    },
    async (baseUrl, events) => {
      const ready = await fetch(`${baseUrl}/ready`);
      assert.equal(ready.status, 200);
      const retry = events.find((event) => event.event === "database_readiness_retry");
      assert.deepEqual(retry, {
        level: "warn",
        event: "database_readiness_retry",
        fields: {
          attempt: 1,
          maxAttempts: RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS,
          name: "PostgresError",
          code: "57P03",
        },
      });
      assert.equal(JSON.stringify(events).includes("private transient details"), false);
    },
  );
});
