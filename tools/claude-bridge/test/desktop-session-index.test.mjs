import assert from "node:assert/strict";
import test from "node:test";
const moduleUrl = new URL("../src/desktop-session-index.mjs", import.meta.url);
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const U = "00000000-0000-4000-8000-000000000003";
const CP = "00000000-0000-4000-8000-000000000004";
const snapshot = { sessionId: A, revision: "hash", entries: [{ type: "user", uuid: U, parentUuid: null }, { type: "assistant", uuid: CP, parentUuid: U }] };
const metadata = { sessionId: `local_${B}`, cliSessionId: A, lastAssistantUuid: CP, cwd: "/fixture", priorCliSessionIds: [B], rewindEdges: [{ child: A, parent: B, forkPoint: U, at: "timestamp" }], remoteMcpServersConfig: [{ secret: "NEVER_EXPORT_THIS" }], promptAppendSnapshot: { append: "PRIVATE_INSTRUCTIONS" }, title: "PRIVATE_TITLE" };

test("Desktop identity uses exact cliSessionId and checkpoint rather than newest file", async () => {
  const { resolveDesktopSession } = await import(moduleUrl);
  const result = resolveDesktopSession(metadata, new Map([[A, snapshot]]));
  assert.equal(result.desktopSessionId, `local_${B}`);
  assert.equal(result.providerSessionId, A);
  assert.equal(result.providerCheckpointId, CP);
  assert.equal(result.nativeRevision, "hash");
  assert.equal(result.activity, "unknown");
  assert.deepEqual(result.rewindEdges, [{ child: A, parent: B, forkPoint: U }]);
  assert.deepEqual(result.missingSessionIds, [B]);
  assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPORT_THIS|PRIVATE_INSTRUCTIONS|PRIVATE_TITLE/);
});

test("missing selected session does not fall back to a prior or newer session", async () => {
  const { resolveDesktopSession } = await import(moduleUrl);
  assert.throws(() => resolveDesktopSession(metadata, new Map([[B, { ...snapshot, sessionId: B }]])), e => e.code === "DESKTOP_NATIVE_SESSION_UNAVAILABLE");
});

test("stale, user-only and sidechain checkpoints cannot be used as selected assistant head", async () => {
  const { resolveDesktopSession } = await import(moduleUrl);
  for (const entries of [snapshot.entries.slice(0, 1), [{ type: "user", uuid: CP, parentUuid: null }], [{ type: "assistant", uuid: CP, parentUuid: null, isSidechain: true }]]) {
    assert.throws(() => resolveDesktopSession(metadata, new Map([[A, { ...snapshot, entries }]])), e => e.code === "DESKTOP_CHECKPOINT_UNAVAILABLE");
  }
});

test("unknown Desktop index shapes fail closed rather than guessing aliases", async () => {
  const { resolveDesktopSession } = await import(moduleUrl);
  for (const changes of [{ cliSessionId: undefined }, { lastAssistantUuid: undefined }, { rewindEdges: {} }, { priorCliSessionIds: {} }, { cliSessionId: "../escape" }, { rewindEdges: [{ child: A, parent: B, forkPoint: "invalid" }] }]) {
    assert.throws(() => resolveDesktopSession({ ...metadata, ...changes }, new Map([[A, snapshot]])), e => e.code === "UNSUPPORTED_DESKTOP_SESSION_INDEX");
  }
});

test("cyclic or broken native ancestry is rejected despite valid Desktop metadata", async () => {
  const { resolveDesktopSession } = await import(moduleUrl);
  const broken = { ...snapshot, entries: [{ type: "assistant", uuid: CP, parentUuid: CP }] };
  assert.throws(() => resolveDesktopSession(metadata, new Map([[A, broken]])), e => e.code === "DESKTOP_CHECKPOINT_UNAVAILABLE");
});
