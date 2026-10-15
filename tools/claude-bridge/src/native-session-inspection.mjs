import { createHash } from "node:crypto";
import { readNativeHistorySources, verifyNativeHistorySources } from "./native-session-source-files.mjs";
import { TextDecoder } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readOnlyFileSnapshot } from "./read-only-file-snapshot.mjs";
import { readNativeSession } from "./native-session-catalog.mjs";
import { resolveDesktopSession, resolveLocalNativeSession } from "./desktop-session-index.mjs";
import { projectNativeHistory, nativeContinuationCheckpoint, nativeDisplayChain, nativeDisplayAssetRevision } from "./native-session-history.mjs";
import { readNativeSessionActivity } from "./native-session-activity.mjs";

const fail = code => Object.assign(new Error(code), { code });
const historyErrors = new Set(["COMPACT_SOURCE_HISTORY_REQUIRED", "NATIVE_HISTORY_GAP", "INVALID_NATIVE_PARENT", "CONFLICTING_NATIVE_UUID", "NATIVE_SOURCE_SCAN_LIMIT"]);
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicErrors = new Set(["INVALID_NATIVE_JSON", "NATIVE_FILE_TOO_LARGE", "NATIVE_FILE_CHANGED_DURING_READ", "INVALID_SESSION_ID", "UNSUPPORTED_DESKTOP_SESSION_INDEX", "DESKTOP_NATIVE_SESSION_UNAVAILABLE", "DESKTOP_CHECKPOINT_UNAVAILABLE", "NATIVE_INSPECTION_CHANGED", "AMBIGUOUS_NATIVE_SESSION_LOCATION", "DESKTOP_INDEX_IDENTITY_MISMATCH", "STALE_NATIVE_SELECTION", "NATIVE_SELECTION_NOT_FOUND", "AMBIGUOUS_NATIVE_SELECTION", "NATIVE_TURN_UNFINISHED", "EXPLICIT_BRANCH_SELECTION_REQUIRED"]);
export const nativeInspectionErrorCode = error => publicErrors.has(error?.code) ? error.code : "NATIVE_INSPECTION_UNAVAILABLE";

async function readIndex(indexFile) {
  const index = await readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024);
  let metadata;
  try { metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(index.bytes)); }
  catch { throw fail("INVALID_NATIVE_JSON"); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw fail("INVALID_NATIVE_JSON");
  return { ...index, metadata };
}

// Read-only preparation evidence. This deliberately has no resume/fork/write API.
async function loadDesktopNativeSession({ indexFile, projectDirectory, peerDirectory, probeProcessStart, followNativeContinuation = false, expectedSessionId }) {
  // indexFile === null selects a local-only session (no Desktop window yet) by its pinned id.
  if (indexFile === null && !sessionPattern.test(expectedSessionId ?? "")) throw fail("INVALID_SESSION_ID");
  const index = indexFile === null ? null : await readIndex(indexFile);
  const metadata = index?.metadata ?? {};
  const snapshot = await readNativeSession(projectDirectory, index ? metadata.cliSessionId : expectedSessionId);
  const identity = index ? resolveDesktopSession(metadata, new Map([[snapshot.sessionId, snapshot]])) : resolveLocalNativeSession(snapshot);
  let sourceSnapshots = [];
  try { nativeDisplayChain(snapshot, identity.providerCheckpointId); }
  catch (error) {
    if (!['COMPACT_SOURCE_HISTORY_REQUIRED', 'NATIVE_HISTORY_GAP'].includes(error.code)) throw error;
    sourceSnapshots = await readNativeHistorySources(projectDirectory, snapshot.sessionId, snapshot);
  }
  const options = { sourceSnapshots };
  if (followNativeContinuation) identity.providerCheckpointId = nativeContinuationCheckpoint(snapshot, identity.providerCheckpointId, options);
  let history;
  let projection = null;
  try {
    projection = projectNativeHistory(snapshot, identity.providerCheckpointId, options);
    history = { state: "complete", messageCount: projection.messages.length, blockCount: projection.messages.reduce((sum, message) => sum + message.blocks.length, 0) };
  } catch (error) {
    if (!historyErrors.has(error.code)) throw error;
    history = { state: "unavailable", reason: error.code, messageCount: null, blockCount: null };
  }
  // Source evidence participates in selection fencing separately from the
  // execution revision. Never append reconstructed ancestry to the SDK root.
  const historyRevision = sourceSnapshots.length ? createHash('sha256').update(JSON.stringify(
    sourceSnapshots.map(s => [s.sessionId, s.revision]),
  )).digest('hex') : null;
  let displayAssets;
  if (projection && sourceSnapshots.length) {
    const chain = nativeDisplayChain(snapshot, identity.providerCheckpointId, options);
    const entries = chain.filter(e => Array.isArray(e.message?.content) && e.message.content.some(b => ['image', 'document'].includes(b?.type)))
      .map(e => ({ type: e.type, uuid: e.uuid, message: { content: e.message.content.map(b => ['image', 'document'].includes(b?.type) ? b : null) } }));
    if (entries.length) displayAssets = { entries, revision: nativeDisplayAssetRevision(entries) };
  }
  const activity = await readNativeSessionActivity(peerDirectory, snapshot.sessionId, { probeProcessStart });
  const [currentIndex, currentSource] = await Promise.all([
    index ? readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024) : null,
    readNativeSession(projectDirectory, snapshot.sessionId),
  ]);
  if ((index && currentIndex.revision !== index.revision) || currentSource.revision !== snapshot.revision) throw fail("NATIVE_INSPECTION_CHANGED");
  await verifyNativeHistorySources(projectDirectory, sourceSnapshots);
  const activityTime = new Date(metadata.lastActivityAt ?? snapshot.entries.findLast(entry => typeof entry.timestamp === "string")?.timestamp ?? NaN);
  return { inspection: { readOnly: true, ...identity, title: typeof metadata.title === 'string' ? metadata.title.slice(0, 160) : null,
    updatedAt: Number.isFinite(activityTime.getTime()) ? activityTime.toISOString() : null,
    activity, history, historyRevision, handoffAllowed: false }, projection,
    nativeSnapshot: { sessionId: snapshot.sessionId, revision: snapshot.revision, entries: snapshot.entries, ...(displayAssets ? { displayAssets } : {}) } };
}

// Fast, source-only checkpoint inspection for a metadata-only handoff.
// Does not reconstruct pre-Compact display history, stage assets, or upload JSONL.
// This is an observation, not proof that Desktop has stopped writing.
export async function inspectNativeCheckpointOnly(input) {
  const { indexFile, projectDirectory, peerDirectory, probeProcessStart, expectedSessionId } = input;
  if (indexFile === null && !sessionPattern.test(expectedSessionId ?? '')) throw fail('INVALID_SESSION_ID');
  const index = indexFile === null ? null : await readIndex(indexFile);
  const sessionId = index ? index.metadata.cliSessionId : expectedSessionId;
  const snapshot = await readNativeSession(projectDirectory, sessionId);
  const identity = index
    ? resolveDesktopSession(index.metadata, new Map([[snapshot.sessionId, snapshot]]))
    : resolveLocalNativeSession(snapshot);
  const activity = await readNativeSessionActivity(peerDirectory, snapshot.sessionId, { probeProcessStart });
  const [currentIndex, currentSource] = await Promise.all([
    index ? readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024) : null,
    readNativeSession(projectDirectory, snapshot.sessionId),
  ]);
  if ((index && currentIndex.revision !== index.revision)
    || currentSource.revision !== snapshot.revision) throw fail('NATIVE_INSPECTION_CHANGED');
  return {
    readOnly: true, executionAuthorized: false,
    providerSessionId: identity.providerSessionId,
    providerCheckpointId: identity.providerCheckpointId,
    workingDirectory: identity.workingDirectory,
    nativeRevision: snapshot.revision,
    activity,
    historyImported: false,
  };
}

// Pin exactly one native Session without scanning unrelated pre-Compact archives.
// Prefer the selected Desktop window when entering LeileiOS; handoff to Desktop
// uses the local native tip, which must match the backend's committed checkpoint.
export async function resolveNativeCheckpointOnlySelection({
  sessionId, projectsDirectory, desktopSessionsDirectory, peerDirectory,
  probeProcessStart, direction = 'to_leileios',
}) {
  if (!sessionPattern.test(sessionId)) throw fail('INVALID_SESSION_ID');
  const locations = (await nativeSessionLocations(projectsDirectory)).get(sessionId) ?? [];
  if (locations.length !== 1) throw fail(locations.length ? 'AMBIGUOUS_NATIVE_SESSION_LOCATION' : 'NATIVE_SELECTION_NOT_FOUND');
  let indexFile = null;
  if (direction === 'to_leileios') {
    const found = [];
    const accounts = await sortedEntries(desktopSessionsDirectory).catch(() => []);
    for (const account of accounts) {
      if (!account.isDirectory()) continue;
      for (const org of await sortedEntries(path.join(desktopSessionsDirectory, account.name))) {
        if (!org.isDirectory()) continue;
        const directory = path.join(desktopSessionsDirectory, account.name, org.name);
        for (const file of await sortedEntries(directory)) {
          if (!file.isFile() || !/^local_[0-9a-f-]{36}\.json$/i.test(file.name)) continue;
          const candidate = path.join(directory, file.name);
          const index = await readIndex(candidate);
          if (index.metadata.cliSessionId !== sessionId) continue;
          if (index.metadata.sessionId !== file.name.slice(0, -5)) throw fail('DESKTOP_INDEX_IDENTITY_MISMATCH');
          found.push(candidate);
          if (found.length > 1) throw fail('AMBIGUOUS_NATIVE_SELECTION');
        }
      }
    }
    indexFile = found[0] ?? null;
  }
  const input = { indexFile, projectDirectory: locations[0], peerDirectory, expectedSessionId: sessionId, probeProcessStart };
  const selection = await inspectNativeCheckpointOnly(input);
  return { input, selection };
}

export async function inspectDesktopNativeSession(input) {
  return (await loadDesktopNativeSession(input)).inspection;
}

// Internal history payload for a future authenticated restore writer; never log
// or expose it through the diagnostic CLI. Selection is pinned before any write.
export async function readDesktopNativeHistory(input) {
  if (!sessionPattern.test(input.expectedSessionId ?? "") || !sessionPattern.test(input.expectedCheckpointId ?? "") ||
      !/^[0-9a-f]{64}$/.test(input.expectedRevision ?? "")) throw fail("STALE_NATIVE_SELECTION");
  const result = await loadDesktopNativeSession(input);
  if (result.inspection.providerSessionId !== input.expectedSessionId ||
      result.inspection.providerCheckpointId !== input.expectedCheckpointId ||
      result.inspection.nativeRevision !== input.expectedRevision ||
      (input.expectedHistoryRevision !== undefined && result.inspection.historyRevision !== input.expectedHistoryRevision)) throw fail("STALE_NATIVE_SELECTION");
  if (!result.projection) throw fail(result.inspection.history.reason);
  return result;
}

const sortedEntries = async directory => (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));

/** Native session id -> project directories holding `<id>.jsonl`. */
export async function nativeSessionLocations(projectsDirectory) {
  const locations = new Map();
  for (const project of await sortedEntries(projectsDirectory)) {
    if (!project.isDirectory()) continue;
    const directory = path.join(projectsDirectory, project.name);
    for (const file of await sortedEntries(directory)) {
      const id = file.name.slice(0, -6);
      if (!file.isFile() || !file.name.endsWith(".jsonl") || !sessionPattern.test(id)) continue;
      const found = locations.get(id) ?? [];
      found.push(directory);
      locations.set(id, found);
    }
  }
  return locations;
}

async function discoverDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory, probeProcessStart }) {
  const locations = await nativeSessionLocations(projectsDirectory);
  const sessions = [];
  for (const account of await sortedEntries(desktopSessionsDirectory)) {
    if (!account.isDirectory()) continue;
    const accountPath = path.join(desktopSessionsDirectory, account.name);
    for (const org of await sortedEntries(accountPath)) {
      if (!org.isDirectory()) continue;
      const orgPath = path.join(accountPath, org.name);
      for (const file of await sortedEntries(orgPath)) {
        const desktopSessionId = file.name.slice(0, -5);
        if (!file.isFile() || !file.name.endsWith(".json") || !desktopSessionId.startsWith("local_") || !sessionPattern.test(desktopSessionId.slice(6))) continue;
        if (sessions.length >= 1000) throw fail("DESKTOP_INDEX_SCAN_LIMIT");
        let providerSessionId = null;
        try {
          const indexFile = path.join(orgPath, file.name);
          const { metadata } = await readIndex(indexFile);
          providerSessionId = sessionPattern.test(metadata.cliSessionId ?? '') ? metadata.cliSessionId : null;
          if (metadata.sessionId !== desktopSessionId) throw fail("DESKTOP_INDEX_IDENTITY_MISMATCH");
          const candidates = locations.get(metadata.cliSessionId) ?? [];
          if (candidates.length === 0) throw fail("DESKTOP_NATIVE_SESSION_UNAVAILABLE");
          if (candidates.length !== 1) throw fail("AMBIGUOUS_NATIVE_SESSION_LOCATION");
          const result = await inspectDesktopNativeSession({ indexFile, projectDirectory: candidates[0], peerDirectory, probeProcessStart });
          if (result.desktopSessionId !== desktopSessionId) throw fail("DESKTOP_INDEX_IDENTITY_MISMATCH");
          sessions.push({ inspection: result, indexFile, projectDirectory: candidates[0], providerSessionId });
        } catch (error) {
          sessions.push({ providerSessionId, inspection: { desktopSessionId, error: nativeInspectionErrorCode(error), handoffAllowed: false } });
        }
      }
    }
  }
  return sessions;
}

export async function listDesktopNativeSessions(input) {
  return { readOnly: true, sessions: (await discoverDesktopNativeSessions(input)).map(value => value.inspection) };
}

// Resolve by verified identity, never by title/mtime or the first matching path.
// Source paths stay internal to the fixed switch command, not catalog output.
export async function resolveDesktopNativeSelection({ sessionId, ...input }) {
  if (!sessionPattern.test(sessionId ?? '') && !(/^local_/.test(sessionId ?? '') && sessionPattern.test(sessionId.slice(6)))) {
    throw fail('INVALID_SESSION_ID');
  }
  const matches = (await discoverDesktopNativeSessions(input)).filter(value =>
    value.providerSessionId === sessionId || value.inspection.desktopSessionId === sessionId);
  if (matches.length === 0) {
    // No Desktop window (e.g. a LeileiOS Edit/Retry fork): select the local
    // transcript by exact id; Desktop opens a window for it after handoff.
    if (!sessionPattern.test(sessionId)) throw fail('NATIVE_SELECTION_NOT_FOUND');
    const candidates = (await nativeSessionLocations(input.projectsDirectory)).get(sessionId) ?? [];
    if (candidates.length === 0) throw fail('NATIVE_SELECTION_NOT_FOUND');
    if (candidates.length !== 1) throw fail('AMBIGUOUS_NATIVE_SESSION_LOCATION');
    const local = { indexFile: null, projectDirectory: candidates[0] };
    const inspection = await inspectDesktopNativeSession({ ...input, ...local, expectedSessionId: sessionId, followNativeContinuation: true });
    if (inspection.history.state !== 'complete') throw fail(inspection.history.reason);
    return { ...local, inspection };
  }
  if (matches.length !== 1) throw fail('AMBIGUOUS_NATIVE_SELECTION');
  const selected = matches[0];
  if (selected.inspection.error) throw fail(selected.inspection.error);
  if (selected.inspection.history.state !== 'complete') throw fail(selected.inspection.history.reason);
  const source = { indexFile: selected.indexFile, projectDirectory: selected.projectDirectory };
  return { ...source, inspection: await inspectDesktopNativeSession({ ...input, ...source, followNativeContinuation: true }) };
}
