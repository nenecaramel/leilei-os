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
  const runtime = { abort() {}, async deleteSession(id: string) { lifecycle.push("delete:" + id); }, async compact(id: string) { lifecycle.push("compact:" + id); return {}; }, async listSessions(input: unknown) { assert.deepEqual(input, { allDirectories: true, limit: 100, offset: 0 }); return [{ cwd: historical, sessionId: "external", summary: null, customTitle: null, firstPrompt: null, gitBranch: null, lastModified: 1, createdAt: 1 }]; } };
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
