import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const moduleUrl = new URL("../src/native-session-activity.mjs", import.meta.url);
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const started = "Sat Oct 10 03:13:09 2026";
const record = { sessionId: A, pid: 123, pidDomain: "darwin", procStart: started, status: "idle", peerProtocol: 1, messagingSocketPath: "/PRIVATE_SOCKET", key: "PRIVATE_KEY" };

test("idle requires exact process identity, not file timestamps", async () => {
  const { observeNativeSessionActivity } = await import(moduleUrl);
  const result = await observeNativeSessionActivity(A, [record], async pid => { assert.equal(pid, 123); return started; });
  assert.equal(result.state, "idle_observed");
  assert.equal(result.ownerPid, 123);
  assert.equal(result.isWriteLease, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SOCKET|PRIVATE_KEY/);
});

test("running or permission-blocked native session never becomes idle", async () => {
  const { observeNativeSessionActivity } = await import(moduleUrl);
  for (const status of ["working", "running", "waiting_for_permission", "future_status"]) {
    const result = await observeNativeSessionActivity(A, [{ ...record, status }], async () => started);
    assert.equal(result.state, "busy_or_unknown");
  }
});

test("missing, stale, reused PID and unsupported records fail closed", async () => {
  const { observeNativeSessionActivity } = await import(moduleUrl);
  for (const [records, probe] of [
    [[], async () => started],
    [[record], async () => null],
    [[record], async () => "DIFFERENT_START"],
    [[{ ...record, pidDomain: "linux" }], async () => started],
    [[{ ...record, pid: -1 }], async () => started],
    [[{ ...record, peerProtocol: 2 }], async () => started],
    [[record], async () => { throw new Error("probe unavailable"); }],
  ]) assert.equal((await observeNativeSessionActivity(A, records, probe)).state, "unknown");
});

test("multiple live writers are refused and unrelated sessions are never probed", async () => {
  const { observeNativeSessionActivity } = await import(moduleUrl);
  const queried = [];
  const result = await observeNativeSessionActivity(A, [record, { ...record, pid: 124 }, { ...record, sessionId: B, pid: 999 }], async pid => { queried.push(pid); return started; });
  assert.deepEqual(queried, [123, 124]);
  assert.equal(result.state, "unknown");
  assert.equal(result.reason, "MULTIPLE_NATIVE_WRITERS");
});

test("peer file reader never opens key files and verifies filename PID identity", async () => {
  const { readNativeSessionActivity } = await import(moduleUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "native-peer-test-"));
  try {
    await writeFile(path.join(directory, "123.json"), JSON.stringify(record));
    await writeFile(path.join(directory, "123.key"), "PRIVATE_KEY");
    const result = await readNativeSessionActivity(directory, A, { probeProcessStart: async () => started });
    assert.equal(result.state, "idle_observed");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_KEY|PRIVATE_SOCKET/);
    await writeFile(path.join(directory, "123.json"), JSON.stringify({ ...record, pid: 124 }));
    assert.equal((await readNativeSessionActivity(directory, A)).state, "unknown");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("unsafe, malformed, missing and oversized peer directories stay unknown", async () => {
  const { readNativeSessionActivity } = await import(moduleUrl);
  const directory = await mkdtemp(path.join(tmpdir(), "native-peer-test-"));
  const probeProcessStart = async () => { assert.fail("unsafe files must not be probed"); };
  try {
    assert.equal((await readNativeSessionActivity(path.join(directory, "missing"), A)).state, "unknown");
    await writeFile(path.join(directory, "123.json"), "{broken");
    assert.equal((await readNativeSessionActivity(directory, A, { probeProcessStart })).state, "unknown");
    await writeFile(path.join(directory, "123.json"), " ".repeat(65537));
    assert.equal((await readNativeSessionActivity(directory, A, { probeProcessStart })).state, "unknown");
    await rm(path.join(directory, "123.json"));
    await symlink("123.key", path.join(directory, "123.json"));
    await writeFile(path.join(directory, "123.key"), JSON.stringify(record));
    assert.equal((await readNativeSessionActivity(directory, A, { probeProcessStart })).state, "unknown");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("process probe pins UTC and C locale, and never uses a shell", async () => {
  const { probeNativeProcessStart } = await import(moduleUrl);
  const execute = async (file, args, options) => {
    assert.equal(file, "/bin/ps");
    assert.deepEqual(args, ["-p", "123", "-o", "lstart="]);
    assert.equal(options.env.TZ, "UTC");
    assert.equal(options.env.LC_ALL, "C");
    assert.equal(options.timeout, 2000);
    assert.ok(options.maxBuffer <= 4096);
    return { stdout: ` ${started}\n` };
  };
  assert.equal(await probeNativeProcessStart(123, execute), started);
  await assert.rejects(() => probeNativeProcessStart(-1, execute));
  assert.equal(await probeNativeProcessStart(123, async () => ({ stdout: "" })), null);
});
