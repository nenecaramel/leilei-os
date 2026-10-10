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

test("switch selection resolves a unique native or Desktop ID without exposing private index fields", async () => {
  const { resolveDesktopNativeSelection } = await import(moduleUrl);
  assert.equal(typeof resolveDesktopNativeSelection, 'function');
  await fixture(async ({ root, indexFile }) => {
    const desktopSessionsDirectory = path.join(root, 'indices');
    const projectsDirectory = path.join(root, 'projects');
    const org = path.join(desktopSessionsDirectory, 'account', 'org');
    const project = path.join(projectsDirectory, '-fixture');
    await mkdir(org, { recursive: true });
    await mkdir(project, { recursive: true });
    await copyFile(indexFile, path.join(org, `local_${D}.json`));
    await copyFile(path.join(root, `${A}.jsonl`), path.join(project, `${A}.jsonl`));
    const input = { desktopSessionsDirectory, projectsDirectory, peerDirectory: root, probeProcessStart: async () => started };
    for (const sessionId of [A, `local_${D}`]) {
      const selected = await resolveDesktopNativeSelection({ ...input, sessionId });
      assert.equal(selected.indexFile, path.join(org, `local_${D}.json`));
      assert.equal(selected.projectDirectory, project);
      assert.equal(selected.inspection.providerSessionId, A);
      assert.doesNotMatch(JSON.stringify(selected), /PRIVATE_SECRET|PRIVATE_PROMPT|PRIVATE_REPLY/);
    }
    await assert.rejects(resolveDesktopNativeSelection({ ...input, sessionId: C }), e => e.code === 'NATIVE_SELECTION_NOT_FOUND');
    await assert.rejects(resolveDesktopNativeSelection({ ...input, sessionId: '../escape' }), e => e.code === 'INVALID_SESSION_ID');
    const another = path.join(desktopSessionsDirectory, 'account', 'other-org');
    await mkdir(another);
    await copyFile(indexFile, path.join(another, `local_${D}.json`));
    await assert.rejects(resolveDesktopNativeSelection({ ...input, sessionId: A }), e => e.code === 'AMBIGUOUS_NATIVE_SELECTION');
  });
});
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

test("switch continuation follows completed native additions without changing the Desktop index", async () => {
  const { inspectDesktopNativeSession, readDesktopNativeHistory } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const newUser = '00000000-0000-4000-8000-000000000006';
    const newAssistant = '00000000-0000-4000-8000-000000000007';
    const next = [...entries,
      { type: 'user', uuid: newUser, parentUuid: CP, message: { content: 'PRIVATE_NEW_INPUT' } },
      { type: 'assistant', uuid: newAssistant, parentUuid: newUser, message: { content: 'PRIVATE_NEW_OUTPUT' } },
    ];
    await writeFile(transcriptFile, next.map(JSON.stringify).join('\n'));
    const beforeIndex = await readFile(indexFile);
    const input = { indexFile, projectDirectory: root, peerDirectory: root, followNativeContinuation: true };
    const selection = await inspectDesktopNativeSession(input);
    assert.equal(selection.providerCheckpointId, newAssistant);
    assert.equal(selection.history.messageCount, 4);
    const history = await readDesktopNativeHistory({ ...input, expectedSessionId: A,
      expectedCheckpointId: newAssistant, expectedRevision: selection.nativeRevision });
    assert.equal(history.projection.messages.at(-1).sourceMessageId, newAssistant);
    assert.equal(history.nativeSnapshot.entries.length, 4);
    assert.deepEqual(await readFile(indexFile), beforeIndex);
    assert.doesNotMatch(JSON.stringify(selection), /PRIVATE_/);
    await writeFile(transcriptFile, next.slice(0, -1).map(JSON.stringify).join('\n'));
    await assert.rejects(inspectDesktopNativeSession(input), e => e.code === 'NATIVE_TURN_UNFINISHED');
    await writeFile(transcriptFile, [...entries, { type: 'assistant', uuid: newAssistant, parentUuid: null,
      message: { content: 'detached' } }].map(JSON.stringify).join('\n'));
    await assert.rejects(inspectDesktopNativeSession(input), e => e.code === 'EXPLICIT_BRANCH_SELECTION_REQUIRED');
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

test("existing transport exposes inspection without loading SDK execution or changing its turn state", async () => {
  const { AgentSdkClaudeTransport } = await import("../src/agent-sdk-claude-transport.mjs");
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const desktopSessionsDirectory = path.join(root, "indices");
    const configDirectory = path.join(root, "config");
    const org = path.join(desktopSessionsDirectory, "account", "org");
    const project = path.join(configDirectory, "projects", "project");
    await mkdir(org, { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(path.join(configDirectory, "sessions"));
    await copyFile(indexFile, path.join(org, `local_${D}.json`));
    await copyFile(transcriptFile, path.join(project, `${A}.jsonl`));
    const transport = new AgentSdkClaudeTransport({ environment: { CLAUDE_CONFIG_DIR: configDirectory }, cwd: "/fixture", loadQuery: async () => assert.fail("inspection must not load provider execution") });
    const result = await transport.inspectDesktopSessions({ desktopSessionsDirectory });
    assert.equal(result.sessions[0].history.messageCount, 2);
    assert.equal(result.sessions[0].activity.state, "unknown");
    assert.equal(transport.activeQuery, null);
    assert.equal(transport.activeTurnHandle, null);
    assert.equal(transport.queryImpl, null);
    transport.activeQuery = {};
    await assert.rejects(() => transport.inspectDesktopSessions({ desktopSessionsDirectory }), e => e.runtimeCode === "RUNTIME_UNAVAILABLE");
  });
});

test("history read requires the exact selected session and snapshot revision", async () => {
  const { inspectDesktopNativeSession, readDesktopNativeHistory } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const input = { indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started };
    const selected = await inspectDesktopNativeSession(input);
    const result = await readDesktopNativeHistory({ ...input, expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision });
    assert.equal(result.projection.messages[0].blocks[0].text, "PRIVATE_PROMPT");
    assert.equal(result.projection.messages[1].blocks[0].text, "PRIVATE_REPLY");
    assert.equal(result.projection.checkpointId, CP);
    assert.equal(result.inspection.handoffAllowed, false);
    await assert.rejects(() => readDesktopNativeHistory(input), e => e.code === "STALE_NATIVE_SELECTION");
    await assert.rejects(() => readDesktopNativeHistory({ ...input, expectedSessionId: D, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision }), e => e.code === "STALE_NATIVE_SELECTION");
    await writeFile(transcriptFile, [...entries, { type: "attachment", uuid: C, parentUuid: CP }].map(JSON.stringify).join("\n"));
    await assert.rejects(() => readDesktopNativeHistory({ ...input, expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision }), e => e.code === "STALE_NATIVE_SELECTION");
  });
});

test("missing original compact history cannot be downloaded as a complete history payload", async () => {
  const { inspectDesktopNativeSession, readDesktopNativeHistory } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    await writeFile(transcriptFile, [
      { type: "system", subtype: "compact_boundary", uuid: C, parentUuid: null, logicalParentUuid: CP },
      { ...entries[0], parentUuid: C, isCompactSummary: true }, entries[1],
    ].map(JSON.stringify).join("\n"));
    const input = { indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started };
    const selected = await inspectDesktopNativeSession(input);
    await assert.rejects(() => readDesktopNativeHistory({ ...input, expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision }), e => e.code === "COMPACT_SOURCE_HISTORY_REQUIRED");
  });
});

test("a Desktop-selected head change is stale even when native file bytes have not changed", async () => {
  const { inspectDesktopNativeSession, readDesktopNativeHistory } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    await writeFile(transcriptFile, [...entries, { ...entries[1], uuid: C }].map(JSON.stringify).join("\n"));
    const input = { indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started };
    const selected = await inspectDesktopNativeSession(input);
    await writeFile(indexFile, JSON.stringify({ ...metadata, lastAssistantUuid: C }));
    await assert.rejects(() => readDesktopNativeHistory({ ...input, expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision }), e => e.code === "STALE_NATIVE_SELECTION");
  });
});

test("internal selected history retains complete native records without leaking them into diagnostics", async () => {
  const { inspectDesktopNativeSession, readDesktopNativeHistory } = await import(moduleUrl);
  await fixture(async ({ root, indexFile, transcriptFile }) => {
    const nativeEntries = [
      { ...entries[0], message: { content: [
        { type: "text", text: "PRIVATE_PROMPT" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "c3ludGhldGlj" } },
      ] } },
      { ...entries[1], message: { content: [
        { type: "thinking", thinking: "PRIVATE_THINKING", signature: "synthetic-signature" },
        { type: "text", text: "PRIVATE_REPLY" },
      ] } },
      { ...entries[1], uuid: C, isSidechain: true, message: { content: "PRIVATE_SIDECHAIN" } },
      { type: "file-history-snapshot", messageId: U, snapshot: { synthetic: true } },
    ];
    await writeFile(transcriptFile, nativeEntries.map(JSON.stringify).join("\n"));
    const bytes = await readFile(transcriptFile);
    const input = { indexFile, projectDirectory: root, peerDirectory: root, probeProcessStart: async () => started };
    const selected = await inspectDesktopNativeSession(input);
    const result = await readDesktopNativeHistory({ ...input, expectedSessionId: A, expectedCheckpointId: CP, expectedRevision: selected.nativeRevision });
    assert.deepEqual(result.nativeSnapshot, { sessionId: A, revision: selected.nativeRevision, entries: nativeEntries });
    assert.equal(result.projection.messages.length, 2);
    assert.doesNotMatch(JSON.stringify(result.projection), /PRIVATE_THINKING|PRIVATE_SIDECHAIN|synthetic-signature|c3ludGhldGlj/);
    assert.doesNotMatch(JSON.stringify(selected), /PRIVATE|synthetic-signature|c3ludGhldGlj|file-history-snapshot/);
    const stdout = execFileSync(process.execPath, [new URL("../scripts/native-session-inspect.mjs", import.meta.url).pathname,
      "--desktop-index", indexFile, "--project-dir", root, "--peer-dir", root], { encoding: "utf8" });
    assert.doesNotMatch(stdout, /PRIVATE|synthetic-signature|c3ludGhldGlj|nativeSnapshot/);
    assert.deepEqual(await readFile(transcriptFile), bytes);
  });
});
