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
  const uuidCounts = new Map();
  for (const entry of prefix) {
    // Count every non-sidechain record, including non-carriers: the final
    // projection selects by UUID, so a sibling candidate must be unique.
    if (entry && !entry.isSidechain && typeof entry.uuid === "string") {
      uuidCounts.set(entry.uuid, (uuidCounts.get(entry.uuid) ?? 0) + 1);
    }
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
  // drops the unanswered call and copies the turn changed. Only a call unanswered
  // in the ancestry, with one candidate result whose UUID is not reused, qualifies.
  const calls = new Set(), answered = new Set();
  for (const id of ancestry) {
    const content = carriers.get(id).message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (carriers.get(id).type === "assistant" && block?.type === "tool_use" && typeof block.id === "string") calls.add(block.id);
      if (block?.type === "tool_result") answered.add(block.tool_use_id);
    }
  }
  const candidates = new Map(), claims = new Map();
  for (const [uuid, entry] of carriers) {
    const content = entry.message?.content;
    if (entry.type !== "user" || ancestry.has(uuid) || conflicts.has(uuid) || uuidCounts.get(uuid) !== 1 || !ancestry.has(entry.parentUuid)
      || carriers.get(entry.parentUuid).type !== "assistant" || !Array.isArray(content) || !content.length
      || !content.every(block => block?.type === "tool_result" && calls.has(block.tool_use_id) && !answered.has(block.tool_use_id))) continue;
    candidates.set(uuid, content.map(block => block.tool_use_id));
    for (const call of new Set(content.map(block => block.tool_use_id))) claims.set(call, (claims.get(call) ?? 0) + 1);
  }
  const results = new Set([...candidates].filter(([, ids]) => ids.every(call => claims.get(call) === 1)).map(([uuid]) => uuid));
  // A manual /compact writes its boundary (parentUuid null) and summary off the
  // message chain: later turns hang off the /compact command, whose parent is
  // the pre-compact leaf. The CLI starts history at the last boundary in file
  // order, so a fork without it reloads everything that boundary compacted.
  // Carry each boundary that compacted this branch, with its summary.
  const compacted = new Set();
  for (const [uuid, entry] of carriers) {
    if (entry.type === "system" && entry.subtype === "compact_boundary" && entry.parentUuid === null
      && !conflicts.has(uuid) && uuidCounts.get(uuid) === 1 && ancestry.has(entry.logicalParentUuid)) compacted.add(uuid);
  }
  for (const [uuid, entry] of carriers) {
    if (entry.type === "user" && entry.isCompactSummary === true && compacted.has(entry.parentUuid)
      && !conflicts.has(uuid) && uuidCounts.get(uuid) === 1) compacted.add(uuid);
  }
  // Claude CLI serializes native Cron separately from the user/assistant
  // message ancestry. A historical edit/retry fork must carry the most recent
  // session-level schedule snapshot even when that metadata was appended
  // AFTER the selected assistant checkpoint. Otherwise creating a new branch
  // silently strips still-valid timers. This is an exact copy of the CLI's
  // own record, not a LeileiOS scheduler or a rescheduled CronCreate.
  const latestCronCarry = entries.slice(index + 1).findLast(entry =>
    entry && typeof entry === "object" && !entry.isSidechain
      && entry.type === "session_cron_carry") ?? null;
  const projected = prefix.filter(entry => !entry.isSidechain
    && (!carriers.has(entry.uuid) || ancestry.has(entry.uuid) || results.has(entry.uuid) || compacted.has(entry.uuid)));
  // The SDK's resumeSessionAt checkpoint can truncate following records.
  // Put the schedule metadata BEFORE that checkpoint so the native reader
  // sees it while keeping the selected assistant as the transcript tail.
  if (latestCronCarry) projected.splice(projected.length - 1, 0, latestCronCarry);
  // Older failed branches can precede a later recovered checkpoint in storage.
  // Only their user-visible ancestry is conversation input; the Cron table is
  // deliberately session-scoped, not tied to a discarded message branch.
  return { prefix: projected, ancestry };
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

