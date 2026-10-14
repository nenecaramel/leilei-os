// SDK-independent canonical transcript validation and query-local read views.
function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export function durableCheckpointPrefix(entries, checkpointId) {
  const index = Array.isArray(entries)
    ? entries.findLastIndex(entry => entry && !entry.isSidechain && entry.uuid === checkpointId)
    : -1;
  if (index < 0) throw runtimeError("Claude checkpoint prefix is not durably present.", { runtimeCode: "NO_PROVIDER_SESSION" });
  const prefix = entries.slice(0, index + 1);
  const carriers = new Map();
  const conflicts = new Set();
  for (const entry of prefix) {
    if (!entry || entry.isSidechain || !["user", "assistant", "system", "attachment"].includes(entry.type)
      || typeof entry.uuid !== "string" || !Object.hasOwn(entry, "parentUuid")) continue;
    if (carriers.has(entry.uuid) && carriers.get(entry.uuid).parentUuid !== entry.parentUuid) {
      conflicts.add(entry.uuid);
    }
    carriers.set(entry.uuid, entry);
  }
  const ancestry = new Set();
  let id = checkpointId;
  while (id !== null) {
    const entry = carriers.get(id);
    if (!entry || conflicts.has(id) || ancestry.has(id) || (entry.parentUuid !== null && typeof entry.parentUuid !== "string")) {
      throw runtimeError("Claude checkpoint prefix is not durably present.", { runtimeCode: "NO_PROVIDER_SESSION" });
    }
    ancestry.add(id);
    id = entry.parentUuid;
  }
  // Parallel tool calls are separate records; an earlier call's result hangs off
  // its own record, outside the ancestry. Keep exactly those results, or a fork
  // drops the unanswered call and copies the turn changed.
  const calls = new Set();
  for (const id of ancestry) {
    const entry = carriers.get(id);
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) if (block?.type === "tool_use" && typeof block.id === "string") calls.add(block.id);
  }
  const results = new Set();
  for (const entry of carriers.values()) {
    const content = entry.message?.content;
    if (entry.type === "user" && !ancestry.has(entry.uuid) && ancestry.has(entry.parentUuid)
      && carriers.get(entry.parentUuid).type === "assistant" && Array.isArray(content) && content.length
      && content.every(block => block?.type === "tool_result" && calls.has(block.tool_use_id))) results.add(entry.uuid);
  }
  // Older failed branches can precede a later recovered checkpoint in storage.
  // Only its ancestry is conversation input; auxiliary records stay available.
  return {
    prefix: prefix.filter(entry => !entry.isSidechain && (!carriers.has(entry.uuid) || ancestry.has(entry.uuid) || results.has(entry.uuid))),
    ancestry,
  };
}

export function checkpointForkSessionStore(store, sessionId, checkpointId, validatePrefix = false) {
  if (!store || !sessionId || !checkpointId) return store;
  // The CLI applies the latest compact boundary before resolving resumeSessionAt.
  // Materialize only the canonical fork source prefix so a later compact cannot
  // hide a historical checkpoint that still exists in the raw transcript.
  // This is a query-local read view: durable entries and mirror writes stay intact.
  return new Proxy(store, {
    get(target, property) {
      if (property === "load") return async (key) => {
        const entries = await target.load(key);
        if (key.sessionId !== sessionId || key.subpath) return entries;
        if (validatePrefix) return durableCheckpointPrefix(entries, checkpointId).prefix;
        const index = Array.isArray(entries)
          ? entries.findLastIndex(entry => !entry.isSidechain && entry.uuid === checkpointId)
          : -1;
        if (index < 0) throw runtimeError("Claude historical provider checkpoint is not present in the transcript.", {
          runtimeCode: "NO_PROVIDER_SESSION", parentSessionId: sessionId,
        });
        return entries.slice(0, index + 1);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

