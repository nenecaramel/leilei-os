import assert from "node:assert/strict";
import test from "node:test";
import {
  McpSessionRegistry,
  type McpSessionNamespace,
} from "../src/mcp/server/session-registry.js";

type DummySession = {
  sessionId: string;
  userId: string;
  namespace: McpSessionNamespace;
  closeCalls: number;
};

function createDummy(
  registry: McpSessionRegistry,
  input: Pick<DummySession, "sessionId" | "userId" | "namespace">,
): DummySession {
  const session: DummySession = { ...input, closeCalls: 0 };
  registry.register({
    sessionId: session.sessionId,
    userId: session.userId,
    namespace: session.namespace,
    server: {
      close: async () => {
        session.closeCalls += 1;
      },
    } as never,
    transport: {} as never,
  });
  return session;
}

test("registry records timestamps and balances request activity", async () => {
  let now = 1_000;
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 10_000,
    absoluteTtlMs: 20_000,
  });
  createDummy(registry, { sessionId: "s1", userId: "u1", namespace: "public" });

  const acquired = await registry.acquire("s1", "public");
  assert.equal(acquired?.createdAt, 1_000);
  assert.equal(acquired?.lastActivityAt, 1_000);
  assert.equal(acquired?.inFlightCount, 1);

  now = 2_000;
  registry.finishRequest(acquired!);
  const touched = registry.touch("s1");
  assert.equal(touched?.lastActivityAt, 2_000);
  assert.equal(touched?.inFlightCount, 0);
});

test("registry isolates namespaces and users before transport handling", async () => {
  const registry = new McpSessionRegistry();
  createDummy(registry, { sessionId: "public-1", userId: "u1", namespace: "public" });

  assert.equal(await registry.acquire("public-1", "internal"), null);
  const wrongUser = await registry.acquire("public-1", "public", "u2");
  assert.equal(wrongUser, null);
  assert.ok(await registry.acquire("public-1", "public", "u1"));
});

test("idle expiry closes only idle sessions and absolute expiry is bounded", async () => {
  let now = 0;
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 100,
    absoluteTtlMs: 500,
    observer: (event) => events.push(event.name + ":" + event.reason),
  });
  const idle = createDummy(registry, { sessionId: "idle", userId: "u1", namespace: "public" });
  const absolute = createDummy(registry, { sessionId: "absolute", userId: "u1", namespace: "public" });

  const active = await registry.acquire("idle", "public");
  now = 50;
  registry.touch("absolute");
  now = 101;
  await registry.sweep(true);
  assert.ok(registry.find("idle"));
  registry.finishRequest(active!);
  await registry.sweep(true);
  assert.equal(await registry.acquire("idle", "public"), null);
  assert.equal(idle.closeCalls, 1);

  now = 500;
  await registry.sweep(true);
  assert.equal(await registry.acquire("absolute", "public"), null);
  assert.equal(absolute.closeCalls, 1);
  assert.deepEqual(
    events.filter((event) => event.startsWith("mcp_session_closed:")),
    ["mcp_session_closed:idle_ttl", "mcp_session_closed:absolute_ttl"],
  );
});

test("registry close is idempotent and capacity is per user namespace plus process", async () => {
  const registry = new McpSessionRegistry({
    maxPerUser: 2,
    maxTotal: 3,
  });
  createDummy(registry, { sessionId: "a1", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "a2", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "b1", userId: "u1", namespace: "internal" });

  assert.equal(registry.canCreate("u1", "public"), false);
  assert.equal(registry.canCreate("u2", "public"), false);

  await registry.close("a1", "absolute_ttl");
  await registry.close("a1", "absolute_ttl");
  assert.equal(registry.size, 2);
  assert.equal(registry.canCreate("u2", "public"), true);
});

test("transport close cleanup removes the registry entry once", async () => {
  const registry = new McpSessionRegistry();
  const transport = {} as never;
  registry.register({
    sessionId: "s1",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport,
  });

  registry.handleTransportClose(transport);
  registry.handleTransportClose(transport);

  assert.equal(registry.size, 0);
});
