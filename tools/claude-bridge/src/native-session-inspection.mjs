import { TextDecoder } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readOnlyFileSnapshot } from "./read-only-file-snapshot.mjs";
import { readNativeSession } from "./native-session-catalog.mjs";
import { resolveDesktopSession } from "./desktop-session-index.mjs";
import { projectNativeHistory, nativeContinuationCheckpoint } from "./native-session-history.mjs";
import { readNativeSessionActivity } from "./native-session-activity.mjs";

const fail = code => Object.assign(new Error(code), { code });
const historyErrors = new Set(["COMPACT_SOURCE_HISTORY_REQUIRED", "NATIVE_HISTORY_GAP", "INVALID_NATIVE_PARENT", "CONFLICTING_NATIVE_UUID"]);
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
async function loadDesktopNativeSession({ indexFile, projectDirectory, peerDirectory, probeProcessStart, followNativeContinuation = false }) {
  const index = await readIndex(indexFile);
  const { metadata } = index;
  const snapshot = await readNativeSession(projectDirectory, metadata.cliSessionId);
  const identity = resolveDesktopSession(metadata, new Map([[snapshot.sessionId, snapshot]]));
  if (followNativeContinuation) identity.providerCheckpointId = nativeContinuationCheckpoint(snapshot, identity.providerCheckpointId);
  let history;
  let projection = null;
  try {
    projection = projectNativeHistory(snapshot, identity.providerCheckpointId);
    history = { state: "complete", messageCount: projection.messages.length, blockCount: projection.messages.reduce((sum, message) => sum + message.blocks.length, 0) };
  } catch (error) {
    if (!historyErrors.has(error.code)) throw error;
    history = { state: "unavailable", reason: error.code, messageCount: null, blockCount: null };
  }
  const activity = await readNativeSessionActivity(peerDirectory, snapshot.sessionId, { probeProcessStart });
  const [currentIndex, currentSource] = await Promise.all([
    readOnlyFileSnapshot(indexFile, 4 * 1024 * 1024),
    readNativeSession(projectDirectory, snapshot.sessionId),
  ]);
  if (currentIndex.revision !== index.revision || currentSource.revision !== snapshot.revision) throw fail("NATIVE_INSPECTION_CHANGED");
  return { inspection: { readOnly: true, ...identity, activity, history, handoffAllowed: false }, projection,
    nativeSnapshot: { sessionId: snapshot.sessionId, revision: snapshot.revision, entries: snapshot.entries } };
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
      result.inspection.nativeRevision !== input.expectedRevision) throw fail("STALE_NATIVE_SELECTION");
  if (!result.projection) throw fail(result.inspection.history.reason);
  return result;
}

async function discoverDesktopNativeSessions({ desktopSessionsDirectory, projectsDirectory, peerDirectory, probeProcessStart }) {
  const locations = new Map();
  const sortedEntries = async directory => (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
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
  if (matches.length === 0) throw fail('NATIVE_SELECTION_NOT_FOUND');
  if (matches.length !== 1) throw fail('AMBIGUOUS_NATIVE_SELECTION');
  const selected = matches[0];
  if (selected.inspection.error) throw fail(selected.inspection.error);
  if (selected.inspection.history.state !== 'complete') throw fail(selected.inspection.history.reason);
  const source = { indexFile: selected.indexFile, projectDirectory: selected.projectDirectory };
  return { ...source, inspection: await inspectDesktopNativeSession({ ...input, ...source, followNativeContinuation: true }) };
}
