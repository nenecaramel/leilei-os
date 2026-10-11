import { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = code => Object.assign(new Error(code), { code });

// Desktop's index is private/version-sensitive. Read only the observed identity
// fields and verify them against native data. Never propagate config or prompts.
// A native session LeileiOS forked has no Desktop window yet. Its identity comes
// from the transcript alone: the last durable main-chain assistant and its cwd.
export function resolveLocalNativeSession(snapshot) {
  const main = snapshot.entries.filter(entry => !entry.isSidechain);
  const selected = main.findLast(entry => entry.type === "assistant" && uuid(entry.uuid));
  const cwd = main.findLast(entry => typeof entry.cwd === "string")?.cwd;
  if (!selected || typeof cwd !== "string" || !cwd.startsWith("/")) throw fail("DESKTOP_CHECKPOINT_UNAVAILABLE");
  try { durableCheckpointPrefix(snapshot.entries, selected.uuid); } catch { throw fail("DESKTOP_CHECKPOINT_UNAVAILABLE"); }
  return {
    desktopSessionId: null, providerSessionId: snapshot.sessionId, providerCheckpointId: selected.uuid,
    workingDirectory: cwd, nativeRevision: snapshot.revision,
    priorProviderSessionIds: [], rewindEdges: [], missingSessionIds: [], activity: "unknown",
  };
}

export function resolveDesktopSession(metadata, snapshotsBySessionId) {
  const invalid = () => { throw fail("UNSUPPORTED_DESKTOP_SESSION_INDEX"); };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      typeof metadata.sessionId !== "string" || !metadata.sessionId.startsWith("local_") || !uuid(metadata.sessionId.slice(6)) ||
      !uuid(metadata.cliSessionId) || !uuid(metadata.lastAssistantUuid) ||
      typeof metadata.cwd !== "string" || !metadata.cwd.startsWith("/")) invalid();
  const priorIds = metadata.priorCliSessionIds ?? [];
  const edges = metadata.rewindEdges ?? [];
  if (!Array.isArray(priorIds) || priorIds.length > 1000 || !priorIds.every(uuid) ||
      !Array.isArray(edges) || edges.length > 1000 || !edges.every(edge =>
        edge && uuid(edge.child) && uuid(edge.parent) && uuid(edge.forkPoint))) invalid();
  const snapshot = snapshotsBySessionId.get(metadata.cliSessionId);
  if (!snapshot || snapshot.sessionId !== metadata.cliSessionId) throw fail("DESKTOP_NATIVE_SESSION_UNAVAILABLE");
  try {
    const selected = snapshot.entries.findLast(entry => entry.uuid === metadata.lastAssistantUuid && !entry.isSidechain);
    if (selected?.type !== "assistant") throw fail("DESKTOP_CHECKPOINT_UNAVAILABLE");
    durableCheckpointPrefix(snapshot.entries, metadata.lastAssistantUuid);
  } catch {
    throw fail("DESKTOP_CHECKPOINT_UNAVAILABLE");
  }
  const rewindEdges = edges.map(({ child, parent, forkPoint }) => ({ child, parent, forkPoint }));
  const forked = metadata.forkedFromSessionId;
  const forkedFromDesktopSessionId = typeof forked === "string" && forked.startsWith("local_") && uuid(forked.slice(6)) ? forked : null;
  const referenced = new Set([metadata.cliSessionId, ...priorIds, ...rewindEdges.flatMap(edge => [edge.child, edge.parent])]);
  return {
    desktopSessionId: metadata.sessionId,
    providerSessionId: metadata.cliSessionId,
    providerCheckpointId: metadata.lastAssistantUuid,
    workingDirectory: metadata.cwd,
    nativeRevision: snapshot.revision,
    priorProviderSessionIds: [...new Set(priorIds)],
    rewindEdges,
    forkedFromDesktopSessionId,
    missingSessionIds: [...referenced].filter(id => !snapshotsBySessionId.has(id)),
    activity: "unknown",
  };
}
