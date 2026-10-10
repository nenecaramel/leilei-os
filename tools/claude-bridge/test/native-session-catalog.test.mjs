import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, mkdir, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const moduleUrl = new URL("../src/native-session-catalog.mjs", import.meta.url);
const id = "00000000-0000-4000-8000-000000000001";
const entry = (uuid, parentUuid, type = "assistant", extra = {}) => ({ type, uuid, parentUuid, sessionId: id, cwd: "/test/workspace", ...extra });
const rows = [entry("u", null, "user", { message: { content: "PRIVATE_SENTINEL" } }), entry("file", "u", "attachment"), entry("a", "file"), entry("b", "file"), entry("side", "u", "assistant", { isSidechain: true })];
async function fixture(t, entries = rows) {
  const root = await mkdtemp(path.join(tmpdir(), "native-catalog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  await mkdir(project);
  const file = path.join(project, `${id}.jsonl`);
  await writeFile(file, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
  return { root, project, file };
}

test("read-only native catalog implementation exists", async () => {
  await assert.doesNotReject(() => readFile(moduleUrl), "native session catalog is not implemented");
});

test("catalog reports branch candidates without exposing content or guessing active head", async t => {
  const { root, file } = await fixture(t);
  const before = await readFile(file);
  const { listNativeSessions } = await import(moduleUrl);
  const sessions = await listNativeSessions(root);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, id);
  assert.equal(sessions[0].activity, "unknown");
  assert.equal(sessions[0].currentHead, null);
  assert.deepEqual(sessions[0].branches.map(b => b.checkpointId), ["a", "b"]);
  assert.ok(sessions[0].branches.every(b => b.valid && b.entryCount === 3));
  assert.doesNotMatch(JSON.stringify(sessions), /PRIVATE_SENTINEL/);
  assert.deepEqual(await readFile(file), before);
});

test("explicit branch read preserves raw records, attachments and exact ancestry", async t => {
  const { project } = await fixture(t);
  const { readNativeSession, readNativeBranch } = await import(moduleUrl);
  const snapshot = await readNativeSession(project, id);
  assert.deepEqual(snapshot.entries, rows);
  assert.deepEqual(readNativeBranch(snapshot, "a").filter(e => e.uuid).map(e => e.uuid), ["u", "file", "a"]);
  assert.equal(snapshot.revision.length, 64);
  assert.throws(() => readNativeBranch(snapshot, "side"));
});

test("missing ancestry and cycles are reported as unusable branch candidates", async t => {
  const { root } = await fixture(t, [entry("missing", "absent"), entry("cycle", "cycle")]);
  const { listNativeSessions } = await import(moduleUrl);
  const [session] = await listNativeSessions(root);
  assert.ok(session.branches.some(b => !b.valid));
  assert.ok(session.diagnostics.includes("CYCLIC_OR_UNREACHABLE_RECORDS"));
});

test("malformed transcript is isolated and never partly presented as valid", async t => {
  const { root, file } = await fixture(t);
  await writeFile(file, '{"type":"user"');
  const { listNativeSessions } = await import(moduleUrl);
  const [session] = await listNativeSessions(root);
  assert.equal(session.error, "INVALID_TRANSCRIPT");
  assert.equal(session.branches, undefined);
});

test("session path traversal, symlink and oversized files fail closed", async t => {
  const { project, file } = await fixture(t);
  const { readNativeSession } = await import(moduleUrl);
  await assert.rejects(() => readNativeSession(project, "../outside"), e => e.code === "INVALID_SESSION_ID");
  await assert.rejects(() => readNativeSession(project, id, { maxBytes: 1 }), e => e.code === "TRANSCRIPT_TOO_LARGE");
  const other = "00000000-0000-4000-8000-000000000002";
  await symlink(file, path.join(project, `${other}.jsonl`));
  await assert.rejects(() => readNativeSession(project, other));
});

test("conflicting UUID parents cannot become a valid exact checkpoint", async t => {
  const { project } = await fixture(t, [entry("u", null, "user"), entry("u", "other", "user"), entry("a", "u")]);
  const { readNativeSession, readNativeBranch } = await import(moduleUrl);
  const snapshot = await readNativeSession(project, id);
  assert.throws(() => readNativeBranch(snapshot, "a"));
});


test("read-only CLI accepts explicit root and never prints transcript content", async t => {
  const { root, file } = await fixture(t);
  const before = await readFile(file);
  const cli = new URL("../scripts/native-session-catalog.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [cli.pathname, "--projects-dir", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(result.stdout);
  assert.equal(catalog.readOnly, true);
  assert.equal(catalog.sessions.length, 1);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL/);
  assert.deepEqual(await readFile(file), before);
  const bad = spawnSync(process.execPath, [cli.pathname, "--resume", id], { encoding: "utf8" });
  assert.notEqual(bad.status, 0);
});
