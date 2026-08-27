import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpAbsoluteDeadlineScheduler,
  MAX_TIMER_DELAY_MS,
  McpSessionRegistry,
  type McpSessionNamespace,
} from "../src/mcp/server/session-registry.js";

type DummySession = {
  sessionId: string;
  userId: string;
  namespace: McpSessionNamespace;
  closeCalls: number;
};

type FakeTimer = {
  callback: () => void;
  delayMs: number;
  cancelled: boolean;
  unrefCalls: number;
};

function createFakeTimerHarness() {
  const timers: FakeTimer[] = [];
  const scheduler = createMcpAbsoluteDeadlineScheduler({
    setTimeout: (callback, delayMs) => {
      const timer: FakeTimer = { callback, delayMs, cancelled: false, unrefCalls: 0 };
      timers.push(timer);
      return {
        unref: () => { timer.unrefCalls += 1; },
        timer,
      };
    },
    clearTimeout: (handle) => { handle.timer.cancelled = true; },
  });
  return { scheduler, timers };
}

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

test("created and closed events correlate with safe process-local ordinals", async () => {
  const observed: unknown[] = [];
  const registry = new McpSessionRegistry({
    observer: (event) => observed.push(event),
  });
  createDummy(registry, {
    sessionId: "private-session-id-1",
    userId: "private-user-id-1",
    namespace: "public",
  });
  createDummy(registry, {
    sessionId: "private-session-id-2",
    userId: "private-user-id-2",
    namespace: "public",
  });

  await registry.close("private-session-id-1", "client_close");

  const created = observed.filter(
    (event): event is { name: "mcp_session_created"; diagnosticSessionOrdinal: number } =>
      typeof event === "object" && event !== null && (event as { name?: string }).name === "mcp_session_created",
  );
  const closed = observed.filter(
    (event): event is { name: "mcp_session_closed"; diagnosticSessionOrdinal: number } =>
      typeof event === "object" && event !== null && (event as { name?: string }).name === "mcp_session_closed",
  );

  assert.deepEqual(created.map((event) => event.diagnosticSessionOrdinal), [1, 2]);
  assert.equal(closed[0]?.diagnosticSessionOrdinal, 1);
  const serialized = JSON.stringify(observed);
  assert.equal(serialized.includes("private-session-id-1"), false);
  assert.equal(serialized.includes("private-session-id-2"), false);
  assert.equal(serialized.includes("private-user-id-1"), false);
  assert.equal(serialized.includes("private-user-id-2"), false);
});

test("capacity rejection reports idle and in-flight composition for one user namespace", async () => {
  let now = 1_000;
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    maxPerUser: 8,
    maxTotal: 10,
    observer: (event) => events.push(event),
  });

  createDummy(registry, { sessionId: "in-flight", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "idle-old", userId: "u1", namespace: "public" });
  createDummy(registry, { sessionId: "idle-new", userId: "u1", namespace: "public" });
  const inFlight = await registry.acquire("in-flight", "public", "u1");
  assert.ok(inFlight);
  now = 1_100;
  registry.touch("idle-new");
  now = 1_300;

  createDummy(registry, { sessionId: "other-user", userId: "u2", namespace: "public" });
  createDummy(registry, { sessionId: "internal", userId: "u1", namespace: "internal" });
  registry.observeCapacityRejected("u1", "public");

  const event = events.find((candidate) => candidate.name === "mcp_session_capacity_rejected");
  assert.ok(event);
  assert.equal(event.activeUserNamespaceCount, 3);
  assert.equal(event.idleUserNamespaceCount, 2);
  assert.equal(event.inFlightUserNamespaceCount, 1);
  assert.equal(event.oldestIdleAgeMs, 300);
  assert.equal(
    (event.idleUserNamespaceCount as number) + (event.inFlightUserNamespaceCount as number),
    event.activeUserNamespaceCount,
  );
});

test("close diagnostics report in-flight count and idle age without identifiers", async () => {
  let now = 5_000;
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    observer: (event) => events.push(event),
  });
  const session = createDummy(registry, {
    sessionId: "close-private-session",
    userId: "close-private-user",
    namespace: "public",
  });
  const acquired = await registry.acquire(session.sessionId, "public", session.userId);
  assert.ok(acquired);
  registry.finishRequest(acquired);
  now = 5_250;
  await registry.close(session.sessionId, "transport_close");

  const event = events.find((candidate) => candidate.name === "mcp_session_closed");
  assert.ok(event);
  assert.equal(event.inFlightCountAtClose, 0);
  assert.equal(event.idleAgeMsAtClose, 250);
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes(session.sessionId), false);
  assert.equal(serialized.includes(session.userId), false);
});

test("chunked absolute deadlines schedule the maximum safe delay before the remainder", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });

  assert.deepEqual(timers.map((timer) => timer.delayMs), [MAX_TIMER_DELAY_MS]);
  assert.equal(timers[0]!.unrefCalls, 1);
  timers[0]!.callback();
  assert.deepEqual(timers.map((timer) => timer.delayMs), [MAX_TIMER_DELAY_MS, 1_000]);
  assert.equal(callbacks, 0);
  assert.equal(timers[1]!.unrefCalls, 1);
  timers[1]!.callback();
  timers[1]!.callback();
  assert.equal(callbacks, 1);
});

test("chunked absolute deadlines cancel during the first chunk", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  const cancel = scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });
  cancel();

  assert.equal(timers[0]!.cancelled, true);
  timers[0]!.callback();
  assert.equal(timers.length, 1);
  assert.equal(callbacks, 0);
});

test("chunked absolute deadlines cancel during a remainder chunk", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  const cancel = scheduler(MAX_TIMER_DELAY_MS + 1_000, () => { callbacks += 1; });
  timers[0]!.callback();
  cancel();

  assert.equal(timers[1]!.cancelled, true);
  timers[1]!.callback();
  assert.equal(timers.length, 2);
  assert.equal(callbacks, 0);
});

test("the default 24-hour absolute TTL needs one timeout", () => {
  const { scheduler, timers } = createFakeTimerHarness();
  let callbacks = 0;
  scheduler(86_400_000, () => { callbacks += 1; });

  assert.deepEqual(timers.map((timer) => timer.delayMs), [86_400_000]);
  timers[0]!.callback();
  assert.equal(callbacks, 1);
  assert.equal(timers.length, 1);
});

test("reservations atomically enforce total and per-user namespace capacity", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 1 });
  const first = registry.reserve("u1", "public");
  const second = registry.reserve("u1", "public");
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(registry.capacitySize, 1);

  registry.release(first!);
  const afterRelease = registry.reserve("u1", "public");
  assert.ok(afterRelease);
  registry.commit(afterRelease!, {
    sessionId: "committed",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport: {} as never,
  });
  assert.equal(registry.capacitySize, 1);
  assert.equal(registry.reserve("u2", "public"), null);
});

test("capacity pressure reclaims the oldest same-user idle session", async () => {
  let now = 1_000;
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    maxPerUser: 2,
    maxTotal: 8,
    observer: (event) => events.push(event),
  });
  const oldest = createDummy(registry, { sessionId: "oldest", userId: "u1", namespace: "public" });
  now = 1_100;
  const newer = createDummy(registry, { sessionId: "newer", userId: "u1", namespace: "public" });

  const reservation = await registry.admit("u1", "public");

  assert.ok(reservation);
  assert.equal(registry.find(oldest.sessionId), null);
  assert.ok(registry.find(newer.sessionId));
  assert.equal(registry.capacitySize, 2);
  const close = events.find((event) => event.name === "mcp_session_closed");
  assert.ok(close);
  assert.equal(close.reason, "capacity_reclaim");
  assert.equal(close.inFlightCountAtClose, 0);
  registry.release(reservation!);
});

test("capacity pressure never reclaims in-flight sessions", async () => {
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    maxPerUser: 2,
    maxTotal: 8,
    observer: (event) => events.push(event),
  });
  const first = createDummy(registry, { sessionId: "in-flight-1", userId: "u1", namespace: "public" });
  const second = createDummy(registry, { sessionId: "in-flight-2", userId: "u1", namespace: "public" });
  assert.ok(await registry.acquire(first.sessionId, "public", "u1"));
  assert.ok(await registry.acquire(second.sessionId, "public", "u1"));

  assert.equal(await registry.admit("u1", "public"), null);
  assert.equal(registry.find(first.sessionId)?.closed, false);
  assert.equal(registry.find(second.sessionId)?.closed, false);
  assert.equal(events.some((event) => event.reason === "capacity_reclaim"), false);
});

test("capacity pressure only reclaims the requester's same-user namespace", async () => {
  let now = 1_000;
  const registry = new McpSessionRegistry({ maxPerUser: 2, maxTotal: 8 });
  const ownOld = createDummy(registry, { sessionId: "own-old", userId: "u1", namespace: "public" });
  now = 1_100;
  const ownNew = createDummy(registry, { sessionId: "own-new", userId: "u1", namespace: "public" });
  now = 1_200;
  const otherUser = createDummy(registry, { sessionId: "other-user", userId: "u2", namespace: "public" });
  const otherNamespace = createDummy(registry, { sessionId: "other-namespace", userId: "u1", namespace: "internal" });

  const reservation = await registry.admit("u1", "public");

  assert.ok(reservation);
  assert.equal(registry.find(ownOld.sessionId), null);
  assert.ok(registry.find(ownNew.sessionId));
  assert.ok(registry.find(otherUser.sessionId));
  assert.ok(registry.find(otherNamespace.sessionId));
  registry.release(reservation!);
});

test("total capacity pressure can reclaim the requester's own idle session", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 4, maxTotal: 2 });
  const own = createDummy(registry, { sessionId: "own-total", userId: "u1", namespace: "public" });
  const other = createDummy(registry, { sessionId: "other-total", userId: "u2", namespace: "public" });

  const reservation = await registry.admit("u1", "public");

  assert.ok(reservation);
  assert.equal(registry.find(own.sessionId), null);
  assert.ok(registry.find(other.sessionId));
  assert.equal(registry.capacitySize, 2);
  registry.release(reservation!);
});

test("full total capacity without an own idle candidate preserves rejection", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 4, maxTotal: 2 });
  const other = createDummy(registry, { sessionId: "other-only", userId: "u2", namespace: "public" });
  const internal = createDummy(registry, { sessionId: "internal-only", userId: "u1", namespace: "internal" });

  assert.equal(await registry.admit("u1", "public"), null);
  assert.ok(registry.find(other.sessionId));
  assert.ok(registry.find(internal.sessionId));
});

test("concurrent pressure admissions reclaim two oldest idle sessions without exceeding capacity", async () => {
  let now = 1_000;
  const events: Array<Record<string, unknown>> = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    maxPerUser: 2,
    maxTotal: 2,
    observer: (event) => events.push(event),
  });
  createDummy(registry, { sessionId: "concurrent-old", userId: "u1", namespace: "public" });
  now = 1_100;
  createDummy(registry, { sessionId: "concurrent-new", userId: "u1", namespace: "public" });

  const reservations = await Promise.all([
    registry.admit("u1", "public"),
    registry.admit("u1", "public"),
  ]);

  assert.equal(reservations.filter(Boolean).length, 2);
  assert.equal(registry.capacitySize, 2);
  assert.equal(registry.size, 0);
  assert.deepEqual(
    events.filter((event) => event.name === "mcp_session_closed").map((event) => event.reason),
    ["capacity_reclaim", "capacity_reclaim"],
  );
  for (const reservation of reservations) registry.release(reservation!);
});

test("provider cleanup failure does not lose a secured replacement reservation", async () => {
  const registry = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 2 });
  registry.register({
    sessionId: "cleanup-fails",
    userId: "u1",
    namespace: "public",
    server: { close: async () => { throw new Error("provider close failed"); } },
    transport: {},
  });

  const reservation = await registry.admit("u1", "public");

  assert.ok(reservation);
  assert.equal(registry.find("cleanup-fails"), null);
  assert.equal(registry.capacitySize, 1);
  registry.release(reservation!);
});

test("concurrent admissions cannot exceed total or per-user namespace limits", async () => {
  const totalLimited = new McpSessionRegistry({ maxPerUser: 8, maxTotal: 1 });
  const totalResults = await Promise.all([
    totalLimited.admit("u1", "public"),
    totalLimited.admit("u2", "public"),
  ]);
  assert.equal(totalResults.filter(Boolean).length, 1);
  assert.equal(totalLimited.capacitySize, 1);

  const userLimited = new McpSessionRegistry({ maxPerUser: 1, maxTotal: 8 });
  const userResults = await Promise.all([
    userLimited.admit("u1", "public"),
    userLimited.admit("u1", "public"),
  ]);
  assert.equal(userResults.filter(Boolean).length, 1);
  assert.equal(userLimited.capacitySize, 1);
});

test("reservation release after failed initialize leaves capacity available", () => {
  const registry = new McpSessionRegistry({ maxTotal: 1 });
  const reservation = registry.reserve("u1", "public");
  assert.ok(reservation);
  registry.release(reservation!);
  assert.equal(registry.capacitySize, 0);
  assert.ok(registry.reserve("u2", "public"));
});

test("expired capacity is reclaimed even inside the lazy sweep throttle window", async () => {
  let now = 0;
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    now: () => now,
    maxTotal: 1,
    idleTtlMs: 100,
    absoluteTtlMs: 1_000,
    sweepMinIntervalMs: 1_000,
    observer: (event) => events.push(event.name + ":" + event.reason),
  });
  const session = createDummy(registry, { sessionId: "expired", userId: "u1", namespace: "public" });
  await registry.sweep();
  now = 101;
  const reservation = await registry.admit("u2", "public");
  assert.ok(reservation);
  assert.equal(session.closeCalls, 1);
  assert.deepEqual(events.filter((event) => event.startsWith("mcp_session_closed:")), ["mcp_session_closed:idle_ttl"]);
});

test("explicit close reason is consumed once and unsolicited transport close remains distinct", async () => {
  const events: string[] = [];
  const registry = new McpSessionRegistry({ observer: (event) => events.push(event.name + ":" + event.reason) });
  const explicitTransport = {};
  registry.register({
    sessionId: "explicit",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport: explicitTransport,
  });
  const explicit = registry.find("explicit")!;
  registry.expectClose(explicit);
  registry.handleTransportClose(explicitTransport);

  const transport = {};
  registry.register({
    sessionId: "transport",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined } as never,
    transport,
  });
  registry.handleTransportClose(transport);
  assert.deepEqual(events, ["mcp_session_created:undefined", "mcp_session_closed:client_close", "mcp_session_created:undefined", "mcp_session_closed:transport_close"]);
});

test("absolute deadline closes an idle session without a request or sweep", async () => {
  const deadlines: Array<{ callback: () => void; cancelled: boolean }> = [];
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    absoluteTtlMs: 86_400_000,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      const deadline = { callback, cancelled: false };
      deadlines.push(deadline);
      return () => { deadline.cancelled = true; };
    },
    observer: (event) => events.push(`${event.name}:${event.reason ?? ""}`),
  });
  const session = createDummy(registry, { sessionId: "hard-deadline", userId: "u1", namespace: "public" });
  assert.equal(deadlines.length, 1);
  deadlines[0]!.callback();
  await Promise.resolve();
  assert.equal(registry.find(session.sessionId), null);
  assert.equal(session.closeCalls, 1);
  assert.deepEqual(events.filter((event) => event.startsWith("mcp_session_closed:")), ["mcp_session_closed:absolute_ttl"]);
});

test("absolute deadline is cancelled when registration observer closes the session", () => {
  let registry!: McpSessionRegistry;
  let cancelled = false;
  registry = new McpSessionRegistry({
    scheduleAbsoluteDeadline: (_delay, _callback) => () => { cancelled = true; },
    observer: (event) => {
      if (event.name === "mcp_session_created") {
        void registry.close("observer-close", "transport_close");
      }
    },
  });
  registry.register({
    sessionId: "observer-close",
    userId: "u1",
    namespace: "public",
    server: { close: async () => undefined },
    transport: {},
  });
  assert.equal(registry.size, 0);
  assert.equal(cancelled, true);
});

test("absolute deadline closes an in-flight session and wins the idle protection", async () => {
  const deadlines: Array<() => void> = [];
  let now = 0;
  const registry = new McpSessionRegistry({
    now: () => now,
    idleTtlMs: 1,
    absoluteTtlMs: 86_400_000,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      deadlines.push(callback);
      return () => undefined;
    },
  });
  const session = createDummy(registry, { sessionId: "in-flight-deadline", userId: "u1", namespace: "public" });
  const acquired = await registry.acquire(session.sessionId, "public");
  assert.equal(acquired?.inFlightCount, 1);
  deadlines[0]!();
  await Promise.resolve();
  assert.equal(registry.find(session.sessionId), null);
  assert.equal(session.closeCalls, 1);
});

test("all close paths cancel the absolute deadline and never emit a second close", async () => {
  const deadlines: Array<{ callback: () => void; cancelled: boolean }> = [];
  const closedReasons: string[] = [];
  let now = 0;
  const registry = new McpSessionRegistry({
    idleTtlMs: 10,
    absoluteTtlMs: 100,
    now: () => now,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      const deadline = { callback, cancelled: false };
      deadlines.push(deadline);
      return () => { deadline.cancelled = true; };
    },
    observer: (event) => {
      if (event.name === "mcp_session_closed") closedReasons.push(event.reason);
    },
  });
  const client = createDummy(registry, { sessionId: "client-close", userId: "u1", namespace: "public" });
  await registry.close(client.sessionId, "client_close");
  deadlines[0]!.callback();

  const transport = {};
  const transportSession = { sessionId: "transport-close", userId: "u1", namespace: "public" as const, closeCalls: 0 };
  registry.register({
    sessionId: transportSession.sessionId,
    userId: transportSession.userId,
    namespace: transportSession.namespace,
    server: { close: async () => { transportSession.closeCalls += 1; } },
    transport,
  });
  registry.handleTransportClose(transport);
  deadlines[1]!.callback();

  const idle = createDummy(registry, { sessionId: "idle-close", userId: "u1", namespace: "public" });
  now = 22;
  await registry.sweep(true);
  deadlines[2]!.callback();

  assert.deepEqual(deadlines.map((deadline) => deadline.cancelled), [true, true, true]);
  assert.deepEqual(closedReasons, ["client_close", "transport_close", "idle_ttl"]);
  assert.equal(client.closeCalls, 1);
  assert.equal(registry.find(transportSession.sessionId), null);
  assert.equal(idle.closeCalls, 1);
});

test("absolute deadline and another close racing still remove once and reclaim capacity once", async () => {
  const deadlines: Array<() => void> = [];
  const events: string[] = [];
  const registry = new McpSessionRegistry({
    maxTotal: 1,
    scheduleAbsoluteDeadline: (_delay, callback) => {
      deadlines.push(callback);
      return () => undefined;
    },
    observer: (event) => {
      if (event.name === "mcp_session_closed") events.push(event.reason);
    },
  });
  const session = createDummy(registry, { sessionId: "race", userId: "u1", namespace: "public" });
  await Promise.all([
    registry.close(session.sessionId, "client_close"),
    Promise.resolve().then(() => deadlines[0]!()),
  ]);
  assert.equal(registry.size, 0);
  assert.equal(registry.capacitySize, 0);
  assert.deepEqual(events, ["client_close"]);
  assert.equal(session.closeCalls, 1);
  assert.ok(registry.reserve("u2", "public"));
});

test("process shutdown rejects admission and invalidates racing reservations", async () => {
  const registry = new McpSessionRegistry();
  const reservation = registry.reserve("u1", "public");
  assert.ok(reservation);

  const shutdown = registry.shutdown();
  assert.equal(registry.isShuttingDown, true);
  assert.equal(registry.reserve("u2", "public"), null);
  assert.equal(await registry.admit("u2", "public"), null);
  assert.throws(
    () =>
      registry.commit(reservation!, {
        sessionId: "late",
        userId: "u1",
        namespace: "public",
        server: { close: async () => undefined },
        transport: {},
      }),
    /MCP_SESSION_REGISTRY_SHUTTING_DOWN/,
  );
  await shutdown;
  assert.equal(registry.capacitySize, 0);
});

test("process shutdown closes every session once and cancels deadlines", async () => {
  const cancelled: number[] = [];
  const registry = new McpSessionRegistry({
    scheduleAbsoluteDeadline: () => {
      const ordinal = cancelled.push(0) - 1;
      return () => {
        cancelled[ordinal] = (cancelled[ordinal] ?? 0) + 1;
      };
    },
  });
  const first = createDummy(registry, {
    sessionId: "shutdown-1",
    userId: "u1",
    namespace: "public",
  });
  const second = createDummy(registry, {
    sessionId: "shutdown-2",
    userId: "u1",
    namespace: "internal",
  });

  await Promise.all([registry.shutdown(), registry.shutdown()]);
  assert.equal(first.closeCalls, 1);
  assert.equal(second.closeCalls, 1);
  assert.equal(registry.size, 0);
  assert.deepEqual(cancelled, [1, 1]);
});

test("process shutdown attempts every provider close before reporting failures", async () => {
  const closed: string[] = [];
  const registry = new McpSessionRegistry();
  registry.register({
    sessionId: "shutdown-failure",
    userId: "u1",
    namespace: "public",
    server: {
      close: async () => {
        closed.push("failure");
        throw new Error("provider close failed");
      },
    },
    transport: {},
  });
  registry.register({
    sessionId: "shutdown-success",
    userId: "u1",
    namespace: "internal",
    server: {
      close: async () => {
        closed.push("success");
      },
    },
    transport: {},
  });

  await assert.rejects(
    registry.shutdown(),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.message === "MCP session shutdown failed" &&
      error.errors.length === 1,
  );
  assert.deepEqual(closed.sort(), ["failure", "success"]);
  assert.equal(registry.size, 0);
});
