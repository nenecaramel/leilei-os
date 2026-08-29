import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { createWebApiRouter } from "../src/web-api/router.js";
import { SentinelDomainError } from "../src/domains/sentinel/sentinel-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const sentinel = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: USER_ID,
  enabled: false,
  timezone: "Asia/Shanghai",
  policyPrompt: "be gentle",
  nextWakeAt: null,
  lastValidWakeAt: null,
  wakeContextCapsule: null,
  wakeContextUpdatedAt: null,
  controlRevision: 0,
  activeWakeRunId: null,
  createdAt: new Date("2026-08-29T00:00:00.000Z"),
  updatedAt: new Date("2026-08-29T00:00:00.000Z"),
};

function dependencies(service: Record<string, unknown>) {
  return {
    memory: { memoryService: {} as never },
    diary: { diaryService: {} as never },
    task: { taskService: {} as never },
    toy: { toyService: {} as never },
    system: { systemService: {} as never },
    sentinel: { sentinelService: service },
  } as never;
}

async function withServer(
  service: Record<string, unknown>,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (request.header("x-test-user")) request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1", createWebApiRouter(dependencies(service)));
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("Sentinel API derives owner from the authenticated web session", async () => {
  const calls: unknown[][] = [];
  await withServer({
    async findSentinel(...args: never[]) { calls.push(args); return sentinel; },
  }, async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/sentinel`);
    assert.equal(unauthenticated.status, 401);
    const response = await fetch(`${baseUrl}/api/v1/sentinel`, {
      headers: { "x-test-user": "yes" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.sentinel.id, sentinel.id);
    assert.equal(body.data.sentinel.enabled, false);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], USER_ID);
});

test("Sentinel PUT is strict, validates IANA timezone, and creates disabled state", async () => {
  const calls: unknown[][] = [];
  await withServer({
    async upsertPolicy(...args: never[]) {
      if ((args[1] as { timezone: string }).timezone === "Asia/Beijing") {
        throw new SentinelDomainError("INVALID_TIMEZONE", "private");
      }
      calls.push(args);
      return sentinel;
    },
  }, async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-test-user": "yes" };
    const malformed = await fetch(`${baseUrl}/api/v1/sentinel`, {
      method: "PUT", headers,
      body: JSON.stringify({ timezone: "Asia/Shanghai", policyPrompt: "x", userId: "attacker" }),
    });
    assert.equal(malformed.status, 400);
    const invalidTimezone = await fetch(`${baseUrl}/api/v1/sentinel`, {
      method: "PUT", headers,
      body: JSON.stringify({ timezone: "Asia/Beijing", policyPrompt: "x" }),
    });
    assert.equal(invalidTimezone.status, 400);
    const created = await fetch(`${baseUrl}/api/v1/sentinel`, {
      method: "PUT", headers,
      body: JSON.stringify({ timezone: "Asia/Shanghai", policyPrompt: "x" }),
    });
    assert.equal(created.status, 200);
    assert.equal((await created.json()).data.sentinel.enabled, false);
  });
  assert.deepEqual(calls, [[USER_ID, { timezone: "Asia/Shanghai", policyPrompt: "x" }]]);
});

test("Sentinel controls delegate owner-scoped mutations and bounded wake activity", async () => {
  const calls: unknown[][] = [];
  const applied = { outcome: "applied", sentinel };
  await withServer({
    async pause(...args: never[]) { calls.push(["pause", ...args]); return applied; },
    async resume(...args: never[]) { calls.push(["resume", ...args]); return applied; },
    async resumeNow(...args: never[]) { calls.push(["resume-now", ...args]); return applied; },
    async wakeNow(...args: never[]) { calls.push(["wake-now", ...args]); return applied; },
    async recover(...args: never[]) { calls.push(["recover", ...args]); return applied; },
    async listWakeActivity(...args: never[]) { calls.push(["wakes", ...args]); return []; },
  }, async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-test-user": "yes" };
    for (const path of ["pause", "resume-now", "wake-now", "recover"] as const) {
      const response = await fetch(`${baseUrl}/api/v1/sentinel/${path}`, {
        method: "POST", headers, body: JSON.stringify({}),
      });
      assert.equal(response.status, 200, path);
    }
    const resume = await fetch(`${baseUrl}/api/v1/sentinel/resume`, {
      method: "POST", headers,
      body: JSON.stringify({ next_wake_at: "2026-08-30T00:00:00.000Z" }),
    });
    assert.equal(resume.status, 200);
    const wakes = await fetch(`${baseUrl}/api/v1/sentinel/wakes?limit=2`, {
      headers: { "x-test-user": "yes" },
    });
    assert.equal(wakes.status, 200);
  });
  assert.deepEqual(calls.map((call) => call[0]), ["pause", "resume-now", "wake-now", "recover", "resume", "wakes"]);
  assert.equal(calls.find((call) => call[0] === "wakes")?.[2], 2);
  assert.equal(calls.find((call) => call[0] === "resume")?.[2] instanceof Date, true);
});

test("Sentinel control bodies are strict and reject explicit null or identity selectors", async () => {
  let calls = 0;
  await withServer({
    async pause() { calls += 1; return { outcome: "applied", sentinel }; },
  }, async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-test-user": "yes" };
    const explicitNull = await fetch(`${baseUrl}/api/v1/sentinel/pause`, {
      method: "POST", headers, body: "null",
    });
    assert.equal(explicitNull.status, 400);
    const identity = await fetch(`${baseUrl}/api/v1/sentinel/pause`, {
      method: "POST", headers, body: JSON.stringify({ userId: "attacker" }),
    });
    assert.equal(identity.status, 400);
  });
  assert.equal(calls, 0);
});

test("Sentinel cross-user lookups are owner-safe not-found", async () => {
  await withServer({
    async findSentinel() { return null; },
    async listWakeActivity() { throw new SentinelDomainError("SENTINEL_NOT_FOUND", "private"); },
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/sentinel`, {
      headers: { "x-test-user": "yes" },
    });
    assert.equal(response.status, 404);
    const wakes = await fetch(`${baseUrl}/api/v1/sentinel/wakes`, {
      headers: { "x-test-user": "yes" },
    });
    assert.equal(wakes.status, 404);
  });
});
