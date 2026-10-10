import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const moduleUrl = new URL("../src/native-session-inspection.mjs", import.meta.url);
const A = "00000000-0000-4000-8000-000000000001";
const D = "00000000-0000-4000-8000-000000000002";
const U = "00000000-0000-4000-8000-000000000003";
const CP = "00000000-0000-4000-8000-000000000004";
const C = "00000000-0000-4000-8000-000000000005";
const started = "Sat Oct 10 03:13:09 2026";
const metadata = { sessionId: `local_${D}`, cliSessionId: A, lastAssistantUuid: CP, cwd: "/fixture", secret: "PRIVATE_SECRET" };
const entries = [
  { type: "user", uuid: U, parentUuid: null, message: { content: "PRIVATE_PROMPT" } },
  { type: "assistant", uuid: CP, parentUuid: U, message: { content: "PRIVATE_REPLY" } },
];
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "native-inspection-test-"));
  const indexFile = path.join(root, "desktop.json");
  const transcriptFile = path.join(root, `${A}.jsonl`);
  const files = () => Promise.all([writeFile(indexFile, JSON.stringify(metadata)), writeFile(transcriptFile, entries.map(JSON.stringify).join("\n")), writeFile(path.join(root, "123.json"), JSON.stringify({ sessionId: A, pid: 123, pidDomain: "darwin", peerProtocol: 1, status: "idle", procStart: started }))]);
  try { await files(); await run({ root, indexFile, transcriptFile }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("inspection connects verified identity, history and activity without granting a write lease", async () => {
  const { inspectDesktopNativeSession } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const before = await readFile(transcriptFile);
    const result = await inspectDesktopNativeSession({ indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started });
    assert.equal(result.providerSessionId, A);
    assert.equal(result.providerCheckpointId, CP);
    assert.equal(result.history.state, "complete");
    assert.equal(result.history.messageCount, 2);
    assert.equal(result.activity.state, "idle_observed");
    assert.equal(result.handoffAllowed, false);
    assert.equal(result.readOnly, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|PRIVATE_PROMPT|PRIVATE_REPLY/);
    assert.deepEqual(await readFile(transcriptFile), before);
  });
});

test("rewritten compact history reports a gap instead of pretending summaries are old messages", async () => {
  const { inspectDesktopNativeSession } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    await writeFile(transcriptFile, [
      { type: "system", subtype: "compact_boundary", uuid: C, parentUuid: null, logicalParentUuid: CP },
      { ...entries[0], parentUuid: C, isCompactSummary: true }, entries[1],
    ].map(JSON.stringify).join("\n"));
    const result = await inspectDesktopNativeSession({ indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started });
    assert.equal(result.history.state, "unavailable");
    assert.equal(result.history.reason, "COMPACT_SOURCE_HISTORY_REQUIRED");
    assert.equal(result.history.messageCount, null);
    assert.equal(result.handoffAllowed, false);
  });
});

test("inspection rejects stale heads, malformed or unsafe indices without private diagnostics", async () => {
  const { inspectDesktopNativeSession } = await import(moduleUrl);
  await fixture(async ({ root, indexFile }) => {
    const inspect = () => inspectDesktopNativeSession({ indexFile, projectDirectory: root, peerDirectory: root });
    await writeFile(indexFile, JSON.stringify({ ...metadata, lastAssistantUuid: C }));
    await assert.rejects(inspect, e => e.code === "DESKTOP_CHECKPOINT_UNAVAILABLE");
    await writeFile(indexFile, "{PRIVATE_BROKEN");
    await assert.rejects(inspect, e => e.code === "INVALID_NATIVE_JSON" && !e.message.includes("PRIVATE"));
    await writeFile(indexFile, " ".repeat(4 * 1024 * 1024 + 1));
    await assert.rejects(inspect, e => e.code === "NATIVE_FILE_TOO_LARGE");
    await rm(indexFile);
    await symlink("123.json", indexFile);
    await assert.rejects(inspect);
  });
});

test("changes during activity probe invalidate the combined inspection", async () => {
  const { inspectDesktopNativeSession } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    await assert.rejects(() => inspectDesktopNativeSession({ indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => {
      await writeFile(transcriptFile, [...entries, { type: "attachment", uuid: C, parentUuid: CP }].map(JSON.stringify).join("\n"));
      return started;
    } }), e => e.code === "NATIVE_INSPECTION_CHANGED");
  });
});

test("read-only inspection CLI never prints message bodies or credentials", async () => {
  await fixture(async ({ root, indexFile }) => {
    const script = new URL("../scripts/native-session-inspect.mjs", import.meta.url);
    const stdout = execFileSync(process.execPath, [script.pathname, "--desktop-index", indexFile, "--project-dir", root, "--peer-dir", root], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.history.messageCount, 2);
    assert.equal(result.handoffAllowed, false);
    assert.doesNotMatch(stdout, /PRIVATE_SECRET|PRIVATE_PROMPT|PRIVATE_REPLY/);
  });
});

test("Desktop catalog discovers exact sessions without choosing by mtime or emitting private config", async () => {
  const { listDesktopNativeSessions } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const desktopSessionsDirectory = path.join(root, "indices");
    const projectsDirectory = path.join(root, "projects");
    const org = path.join(desktopSessionsDirectory, "account", "org");
    const project = path.join(projectsDirectory, "project");
    await mkdir(org, { recursive: true });
    await mkdir(project, { recursive: true });
    await copyFile(indexFile, path.join(org, `local_${D}.json`));
    await copyFile(transcriptFile, path.join(project, `${A}.jsonl`));
    const result = await listDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory: root, probeProcessStart: async () => started });
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].providerSessionId, A);
    assert.equal(result.sessions[0].history.messageCount, 2);
    assert.equal(result.sessions[0].handoffAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|PRIVATE_PROMPT|PRIVATE_REPLY/);
    const catalogScript = new URL("../scripts/native-session-catalog.mjs", import.meta.url);
    const stdout = execFileSync(process.execPath, [catalogScript.pathname, "--desktop", "--desktop-dir", desktopSessionsDirectory, "--projects-dir", projectsDirectory, "--peer-dir", root], { encoding: "utf8" });
    assert.equal(JSON.parse(stdout).sessions[0].history.messageCount, 2);
    assert.doesNotMatch(stdout, /PRIVATE_SECRET|PRIVATE_PROMPT|PRIVATE_REPLY/);
    await mkdir(path.join(projectsDirectory, "duplicate"));
    await copyFile(transcriptFile, path.join(projectsDirectory, "duplicate", `${A}.jsonl`));
    const ambiguous = await listDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory: root });
    assert.equal(ambiguous.sessions[0].error, "AMBIGUOUS_NATIVE_SESSION_LOCATION");
  });
});

test("Desktop catalog isolates missing native sessions but refuses mismatched local index filenames", async () => {
  const { listDesktopNativeSessions } = await import(moduleUrl);
  await fixture(async ({ root, indexFile }) => {
    const desktopSessionsDirectory = path.join(root, "indices");
    const projectsDirectory = path.join(root, "projects");
    const org = path.join(desktopSessionsDirectory, "account", "org");
    await mkdir(org, { recursive: true });
    await mkdir(projectsDirectory);
    await copyFile(indexFile, path.join(org, `local_${D}.json`));
    await copyFile(indexFile, path.join(org, `local_${C}.json`));
    const result = await listDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory: root });
    assert.deepEqual(new Set(result.sessions.map(session => session.error)), new Set(["DESKTOP_NATIVE_SESSION_UNAVAILABLE", "DESKTOP_INDEX_IDENTITY_MISMATCH"]));
  });
});
