import assert from "node:assert/strict";
import test from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLiveMacWorkingDirectoryRuntimePool as Pool } from "../src/domains/bridge/mac/native-live-mac-working-directory-runtime.js";

test("directory pool keeps durable paths outside the default, canonicalizes, and configures every remote store", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "directory-pool-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const base = join(root, "default"), historical = join(root, "historical"), alias = join(root, "alias");
  mkdirSync(base); mkdirSync(historical); symlinkSync(historical, alias);
  const calls: unknown[] = [], lifecycle: string[] = [];
  const store = { remote: true }, mcp = { type: "http" as const, url: "https://mcp.example", headers: {} };
  const runtime = { abort() {}, async deleteSession(id: string) { lifecycle.push("delete:" + id); }, async compact(id: string) { lifecycle.push("compact:" + id); return { providerSessionId: id }; }, async listSessions(input: unknown) { assert.deepEqual(input, { allDirectories: true, limit: 100, offset: 0 }); return [{ cwd: historical, sessionId: "external", summary: null, customTitle: null, firstPrompt: null, gitBranch: null, lastModified: 1, createdAt: 1 }]; } };
  const pool = new Pool({}, base, async (_env: unknown, cwd: string, remote: unknown, config: unknown) => { calls.push({ cwd, remote, config }); return { kind: "agent_sdk", runtime }; }, () => store, mcp);
  const defaultBinding = await pool.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory: null });
  assert.equal(defaultBinding.workingDirectory, base);
  const [first, second] = await Promise.all([pool.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory: historical }), pool.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory: alias })]);
  assert.equal(first.workingDirectory, historical); assert.equal(first.runtime, second.runtime);
  assert.deepEqual(calls, [{ cwd: base, remote: store, config: mcp }, { cwd: historical, remote: store, config: mcp }]);
  await pool.compactSession("parent", historical); await pool.deleteSession("parent", historical);
  assert.deepEqual(lifecycle, ["compact:parent", "delete:parent"]);
  const listed = await pool.listExternalSessions(); assert.equal(listed[0]?.workingDirectory, historical);
  for (const expectedWorkingDirectory of ["relative", join(root, "gone"), ""]) {
    await assert.rejects(pool.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory }), (error: any) => error.runtimeCode === "WORKING_DIRECTORY_UNAVAILABLE");
  }
});


test("directory pool defaults foreground Claude runtimes to local SDK transcript storage", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "directory-local-session-store-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const observed: unknown[] = [];
  const runtime = { abort() {}, async deleteSession() {} };
  const pool = new Pool(
    {},
    root,
    async (_env: unknown, _cwd: string, sessionStore: unknown) => {
      observed.push(sessionStore);
      return { kind: "agent_sdk", runtime };
    },
  );
  await pool.resolveWorkingDirectoryRuntime({ expectedWorkingDirectory: null });
  assert.deepEqual(observed, [null]);
});


test("directory pool forwards the canonical compact checkpoint without changing provider identity", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "directory-compact-checkpoint-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const checkpoint = "11111111-1111-4111-8111-111111111111";
  const next = "22222222-2222-4222-8222-222222222222";
  const runtime = { abort() {}, async deleteSession() {}, async compact(id: string, execution: unknown, cp: string | null) {
    assert.equal(id, "A"); assert.equal(execution, null); assert.equal(cp, checkpoint);
    return { providerSessionId: id, providerCheckpointId: next };
  } };
  const pool = new Pool({}, root, async () => ({ kind: "agent_sdk", runtime }));
  const result = await pool.compactSession("A", root, checkpoint);
  assert.equal(result.providerSessionId, "A"); assert.equal(result.providerCheckpointId, next);
});

test("directory pool rejects compact results without a provider session instead of reporting success", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "directory-invalid-compact-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtime = { abort() {}, async deleteSession() {}, async compact() {
    return { providerSessionId: null };
  } };
  const pool = new Pool({}, root, async () => ({ kind: "agent_sdk", runtime }));
  await assert.rejects(pool.compactSession("A", root), /provider session/i);
});
