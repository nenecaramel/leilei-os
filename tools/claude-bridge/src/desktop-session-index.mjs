import { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = code => Object.assign(new Error(code), { code });

// Desktop's index is private/version-sensitive. Read only the observed identity
// fields and verify them against native data. Never propagate config or prompts.
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
  const referenced = new Set([metadata.cliSessionId, ...priorIds, ...rewindEdges.flatMap(edge => [edge.child, edge.parent])]);
  return {
    desktopSessionId: metadata.sessionId,
    providerSessionId: metadata.cliSessionId,
    providerCheckpointId: metadata.lastAssistantUuid,
    workingDirectory: metadata.cwd,
    nativeRevision: snapshot.revision,
    priorProviderSessionIds: [...new Set(priorIds)],
    rewindEdges,
    missingSessionIds: [...referenced].filter(id => !snapshotsBySessionId.has(id)),
    activity: "unknown",
  };
}
