import { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";
import { createHash } from "node:crypto";
import { readNativeHistorySources, verifyNativeHistorySources } from "./native-session-source-files.mjs";
import { TextDecoder, isDeepStrictEqual } from "node:util";
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
async function loadDesktopNativeSession({ indexFile, projectDirectory, peerDirectory, probeProcessStart, followNativeContinuation = false, expectedSessionId, historyMode = "complete" }) {
  // indexFile === null selects a local-only session (no Desktop window yet) by its pinned id.
  if (indexFile === null && !sessionPattern.test(expectedSessionId ?? "")) throw fail("INVALID_SESSION_ID");
  const index = indexFile === null ? null : await readIndex(indexFile);
  const metadata = index?.metadata ?? {};
  const snapshot = await readNativeSession(projectDirectory, index ? metadata.cliSessionId : expectedSessionId);
  const identity = index ? resolveDesktopSession(metadata, new Map([[snapshot.sessionId, snapshot]])) : resolveLocalNativeSession(snapshot);
  let sourceSnapshots = [];
  try { if (historyMode !== "continuation") nativeDisplayChain(snapshot, identity.providerCheckpointId); }
  catch (error) {
    if (!['COMPACT_SOURCE_HISTORY_REQUIRED', 'NATIVE_HISTORY_GAP'].includes(error.code)) throw error;
    sourceSnapshots = await readNativeHistorySources(projectDirectory, snapshot.sessionId, snapshot);
  }
  const options = { sourceSnapshots };
  if (followNativeContinuation) identity.providerCheckpointId = historyMode === "continuation"
    ? nativeExecutionContinuation(snapshot, identity.providerCheckpointId).checkpointId
    : nativeContinuationCheckpoint(snapshot, identity.providerCheckpointId, options);
  let history;
  let projection = null;
  try {
    if (historyMode === "continuation") history = { state: "not_requested" };
    else {
      projection = projectNativeHistory(snapshot, identity.providerCheckpointId, options);
      history = { state: "complete", messageCount: projection.messages.length, blockCount: projection.messages.reduce((sum, message) => sum + message.blocks.length, 0) };
    }
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
    activity, history, historyRevision, ...(historyMode === "continuation" ? { continuationReady: true } : {}), handoffAllowed: false }, projection,
    nativeSnapshot: { sessionId: snapshot.sessionId, revision: snapshot.revision, entries: snapshot.entries, ...(displayAssets ? { displayAssets } : {}) } };
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

async function discoverDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory, probeProcessStart, historyMode }) {
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
          const result = await inspectDesktopNativeSession({ indexFile, projectDirectory: candidates[0], peerDirectory, probeProcessStart, historyMode, followNativeContinuation: historyMode === "continuation" });
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
    if (input.historyMode !== 'continuation' && inspection.history.state !== 'complete') throw fail(inspection.history.reason);
    return { ...local, inspection };
  }
  if (matches.length !== 1) throw fail('AMBIGUOUS_NATIVE_SELECTION');
  const selected = matches[0];
  if (selected.inspection.error) throw fail(selected.inspection.error);
  if (input.historyMode !== 'continuation' && selected.inspection.history.state !== 'complete') throw fail(selected.inspection.history.reason);
  const source = { indexFile: selected.indexFile, projectDirectory: selected.projectDirectory };
  return { ...source, inspection: await inspectDesktopNativeSession({ ...input, ...source, followNativeContinuation: true }) };
}

// Execution ancestry stops at the native compact root. It deliberately never
// expands logicalParentUuid or reads other session files for display history.
function nativeExecutionContinuation(snapshot, desktopCheckpointId) {
  const carriers = snapshot.entries.filter(e => e && !e.isSidechain &&
    ["user", "assistant", "system", "attachment"].includes(e.type) && typeof e.uuid === "string" && Object.hasOwn(e, "parentUuid"));
  const byId = new Map();
  for (const entry of carriers) {
    const previous = byId.get(entry.uuid);
    if (previous && !isDeepStrictEqual([previous.type, previous.parentUuid, previous.message, previous.attachment],
      [entry.type, entry.parentUuid, entry.message, entry.attachment])) throw fail("CONFLICTING_NATIVE_UUID");
    byId.set(entry.uuid, entry);
  }
  const tail = carriers.at(-1);
  if (!tail) throw fail("NATIVE_HISTORY_GAP");
  let ancestry;
  try { ancestry = durableCheckpointPrefix(snapshot.entries, tail.uuid).ancestry; }
  catch { throw fail("NATIVE_HISTORY_GAP"); }
  if (!ancestry.has(desktopCheckpointId)) throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
  const chain = carriers.filter(e => ancestry.has(e.uuid));
  const last = chain.findLast(e => !e.isMeta && !e.isCompactSummary && ["user", "assistant"].includes(e.type));
  if (last?.type !== "assistant" || last.message?.stop_reason === "tool_use" ||
    (Array.isArray(last.message?.content) && last.message.content.at(-1)?.type === "tool_use")) throw fail("NATIVE_TURN_UNFINISHED");
  // Only native Stop receipts may follow a completed reply. An arbitrary tool,
  // attachment or compaction tail is not equivalent to the completed checkpoint.
  const trailing = chain.slice(chain.findLastIndex(e => e.uuid === last.uuid) + 1);
  if (trailing.some(e => e.type !== "system" || e.subtype !== "stop_hook_summary")) throw fail("NATIVE_TURN_UNFINISHED");
  return { checkpointId: last.uuid, checkpointIds: [...ancestry], completedTurnCheckpointIds: [last.uuid, ...trailing.map(e => e.uuid)] };
}

export async function readNativeContinuationEvidence(input) {
  if (!sessionPattern.test(input.expectedSessionId ?? "") || !sessionPattern.test(input.expectedCheckpointId ?? "") ||
    !/^[0-9a-f]{64}$/.test(input.expectedRevision ?? "")) throw fail("STALE_NATIVE_SELECTION");
  const result = await loadDesktopNativeSession({ ...input, historyMode: "continuation", followNativeContinuation: true });
  const { inspection, nativeSnapshot } = result;
  if (inspection.providerSessionId !== input.expectedSessionId || inspection.providerCheckpointId !== input.expectedCheckpointId ||
    inspection.nativeRevision !== input.expectedRevision) throw fail("STALE_NATIVE_SELECTION");
  return { inspection, ...nativeExecutionContinuation(nativeSnapshot, input.expectedCheckpointId) };
}
