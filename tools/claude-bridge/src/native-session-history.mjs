import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { boundedOutput, isReasoning, structuredToolOutput } from "./output-contract.mjs";

const carrierTypes = new Set(["user", "assistant", "system", "attachment"]);
const fail = code => Object.assign(new Error(code), { code });
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assetFingerprint = source => fingerprint(Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b))));
// Session-independent message fingerprint (mirrors the server): image/document
// blocks name the projecting session, so that id is blanked before hashing.
export function neutralMessageFingerprint(message) {
  const { fingerprint: _fingerprint, ...body } = message;
  const blocks = body.blocks.map(block => block.payload && typeof block.payload === "object" && "source_session_id" in block.payload
    ? { ...block, payload: { ...block.payload, source_session_id: "" } } : block);
  return fingerprint({ ...body, blocks });
}

/** Digest of a synchronized prefix: `[sourceMessageId, neutral fingerprint]` pairs. */
export const nativeSyncDigest = pairs => fingerprint(pairs.map(m => [m.sourceMessageId, m.fingerprint]));

// PostgreSQL JSONB preserves values but not object key order.
export function nativeDisplayAssetRevision(entries) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return fingerprint(canonical(entries));
}

// Display ancestry may cross a compaction boundary. This is deliberately NOT
// the provider resume/fork prefix: never substitute it for execution validation.
function displayChain(snapshot, checkpointId) {
  const carriers = new Map();
  const positions = new Map();
  for (const [position, entry] of snapshot.entries.entries()) {
    if (!entry || entry.isSidechain || !carrierTypes.has(entry.type) || typeof entry.uuid !== "string") continue;
    const old = carriers.get(entry.uuid);
    if (old && !isDeepStrictEqual(
      [old.type, old.parentUuid, old.logicalParentUuid, old.message, old.attachment],
      [entry.type, entry.parentUuid, entry.logicalParentUuid, entry.message, entry.attachment],
    )) throw fail("CONFLICTING_NATIVE_UUID");
    if (!old) { carriers.set(entry.uuid, entry); positions.set(entry.uuid, position); }
  }
  const chain = [];
  const seen = new Set();
  let id = checkpointId;
  while (id !== null) {
    const entry = carriers.get(id);
    if (!entry || seen.has(id)) throw fail("NATIVE_HISTORY_GAP");
    if (entry.parentUuid !== null && typeof entry.parentUuid !== "string") throw fail("INVALID_NATIVE_PARENT");
    seen.add(id);
    chain.push(entry);
    id = entry.parentUuid;
    if (id === null && entry.type === "system" && entry.subtype === "compact_boundary") {
      if (typeof entry.logicalParentUuid !== "string" || !entry.logicalParentUuid) throw fail("NATIVE_HISTORY_GAP");
      if (positions.get(entry.logicalParentUuid) >= positions.get(entry.uuid)) throw fail("COMPACT_SOURCE_HISTORY_REQUIRED");
      id = entry.logicalParentUuid;
    }
  }
  chain.reverse();
  if (chain[0]?.isCompactSummary === true) throw fail("COMPACT_SOURCE_HISTORY_REQUIRED");
  return chain;
}

// Recover display-only ancestry using exact native UUID evidence. Source files
// may be renamed by Desktop, so file/session aliases are never the lookup key.
// Matching text, titles, timestamps and latest source tails confer no authority.
export function nativeDisplayChain(snapshot, checkpointId, { sourceSnapshots = [] } = {}) {
  if (!sourceSnapshots.length) return displayChain(snapshot, checkpointId);
  const sources = [snapshot, ...sourceSnapshots];
  // Native compaction updates token usage on retained responses. It does not
  // grant permission to change content, response ID, role or stop semantics.
  const messageBody = message => message && Object.fromEntries(Object.entries(message).filter(([key]) => key !== 'usage'));
  const sameBody = (a, b) => isDeepStrictEqual([a.type, messageBody(a.message), a.attachment], [b.type, messageBody(b.message), b.attachment]);
  const signature = chain => fingerprint(chain.filter(e => !e.isCompactSummary && !(e.type === 'system' && e.subtype === 'compact_boundary')).map(e => [e.uuid, e.type, e.timestamp, messageBody(e.message), e.attachment]));
  const completed = new Map();
  let attempts = 0;
  function walk(source, head, visiting = new Set()) {
    const key = `${sources.indexOf(source)}:${head}`;
    if (++attempts > 10000) throw fail('NATIVE_SOURCE_SCAN_LIMIT');
    if (completed.has(key)) return completed.get(key);
    try { const direct = displayChain(source, head); completed.set(key, direct); return direct; }
    catch (error) { if (!['NATIVE_HISTORY_GAP', 'COMPACT_SOURCE_HISTORY_REQUIRED'].includes(error.code)) throw error; }
    if (visiting.has(key) || visiting.size >= 64) throw fail("NATIVE_HISTORY_GAP");
    const next = new Set(visiting).add(key);
    const byId = new Map();
    const positions = new Map();
    for (const [i, e] of source.entries.entries()) {
      if (!e || e.isSidechain || !carrierTypes.has(e.type) || typeof e.uuid !== 'string') continue;
      const old = byId.get(e.uuid);
      if (old && !isDeepStrictEqual([old.type, old.parentUuid, old.logicalParentUuid, old.message, old.attachment],
        [e.type, e.parentUuid, e.logicalParentUuid, e.message, e.attachment])) throw fail('CONFLICTING_NATIVE_UUID');
      if (!old) { byId.set(e.uuid, e); positions.set(e.uuid, i); }
    }
    const reversed = [], seen = new Set();
    let id = head;
    while (id !== null) {
      const e = byId.get(id);
      if (!e || seen.has(id)) throw fail('NATIVE_HISTORY_GAP');
      if (e.parentUuid !== null && typeof e.parentUuid !== 'string') throw fail('INVALID_NATIVE_PARENT');
      seen.add(id); reversed.push(e); id = e.parentUuid;
      if (id === null && e.type === 'system' && e.subtype === 'compact_boundary') {
        const logical = e.logicalParentUuid;
        if (typeof logical !== 'string' || !logical) throw fail('NATIVE_HISTORY_GAP');
        if (byId.has(logical) && positions.get(logical) < positions.get(e.uuid)) { id = logical; continue; }
        const retained = byId.get(logical);
        const originalId = retained?.forkedFrom?.messageUuid ?? logical;
        const candidates = [];
        const orderedSources = sources.toSorted((a, b) => a.entries.filter(e => e.subtype === 'compact_boundary').length - b.entries.filter(e => e.subtype === 'compact_boundary').length);
        for (const other of orderedSources) {
          if (other === source) continue;
          const original = other.entries.find(v => v?.uuid === originalId && !v.isSidechain && carrierTypes.has(v.type));
          if (!original || (retained && !sameBody(retained, original))) continue;
          // Another compacted copy of this retained tail is not its source.
          if (other.entries.some(v => v?.subtype === 'compact_boundary' && (v.logicalParentUuid === originalId || v.compactMetadata?.preservedMessages?.allUuids?.includes(originalId)))) continue;
          try { candidates.push(walk(other, originalId, next)); }
          catch (error) { if (!['NATIVE_HISTORY_GAP', 'COMPACT_SOURCE_HISTORY_REQUIRED'].includes(error.code)) throw error; }
        }
        if (!candidates.length) throw fail('COMPACT_SOURCE_HISTORY_REQUIRED');
        if (new Set(candidates.map(signature)).size !== 1) throw fail('CONFLICTING_NATIVE_UUID');
        const prefix = candidates[0];
        const metadata = e.compactMetadata;
        let preserved = metadata?.preservedMessages?.allUuids;
        if (!Array.isArray(preserved)) {
          const segment = metadata?.preservedSegment;
          const tail = reversed.toReversed();
          const start = tail.findIndex(v => v.uuid === segment?.headUuid);
          const end = tail.findIndex(v => v.uuid === segment?.tailUuid);
          preserved = start >= 0 && end >= start ? tail.slice(start, end + 1).map(v => v.uuid) : [logical];
        }
        if (!preserved.length || new Set(preserved).size !== preserved.length || preserved.some(uuid => !seen.has(uuid))) throw fail('NATIVE_HISTORY_GAP');
        for (const uuid of preserved) {
          const copy = byId.get(uuid);
          const original = prefix.find(v => v.uuid === (copy?.forkedFrom?.messageUuid ?? uuid));
          if (!original || !sameBody(copy, original) || copy.timestamp !== original.timestamp) throw fail('CONFLICTING_NATIVE_UUID');
        }
        const aliases = new Set(preserved.map(uuid => byId.get(uuid)?.forkedFrom?.messageUuid ?? uuid));
        // Only replace the explicitly retained contiguous suffix. Never trim
        // arbitrary earlier records or silently discard a source branch.
        const suffixStart = prefix.findIndex(v => aliases.has(v.uuid));
        if (suffixStart < 0 || prefix.slice(suffixStart).some(v => !aliases.has(v.uuid))) throw fail('NATIVE_HISTORY_GAP');
        const result = [...prefix.slice(0, suffixStart), ...reversed.toReversed().filter(v => !(v.type === 'system' && v.subtype === 'compact_boundary'))];
        if (result[0]?.isCompactSummary) throw fail('COMPACT_SOURCE_HISTORY_REQUIRED');
        completed.set(key, result);
        return result;
      }
    }
    const result = reversed.toReversed();
    if (result[0]?.isCompactSummary) throw fail('COMPACT_SOURCE_HISTORY_REQUIRED');
    return result;
  }
  return walk(snapshot, checkpointId);
}

// Desktop does not update its index while another client appends to the native
// session. Follow only a completed descendant, never infer a different branch.
export function nativeContinuationCheckpoint(snapshot, desktopCheckpointId, options) {
  const tail = snapshot.entries.findLast(entry => entry && !entry.isSidechain
    && carrierTypes.has(entry.type) && typeof entry.uuid === 'string' && Object.hasOwn(entry, 'parentUuid'));
  if (!tail) throw fail('NATIVE_HISTORY_GAP');
  const chain = nativeDisplayChain(snapshot, tail.uuid, options);
  if (!chain.some(entry => entry.uuid === desktopCheckpointId)) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
  const last = chain.findLast(entry => !entry.isMeta && !entry.isCompactSummary
    && ['user', 'assistant'].includes(entry.type));
  if (last?.type !== 'assistant' || last.message?.stop_reason === 'tool_use'
    || (Array.isArray(last.message?.content) && last.message.content.at(-1)?.type === 'tool_use')) {
    throw fail('NATIVE_TURN_UNFINISHED');
  }
  return last.uuid;
}

function contentBlocks(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function projectBlock(raw, entry, ordinal, sessionId) {
  const rawType = typeof raw?.type === "string" ? raw.type : "unknown";
  if (rawType === "text") return { kind: "text", rawType, text: typeof raw.text === "string" ? raw.text : null, payload: null };
  if (isReasoning(raw)) return { kind: "thinking", rawType, text: null, payload: { redacted: true } };
  if (rawType === "image" || rawType === "document") {
    const source = raw.source ?? {};
    return { kind: rawType === "image" ? "image" : "file", rawType, text: null, payload: {
      source_entry_uuid: entry.uuid, source_block_ordinal: ordinal,
      source_session_id: sessionId, source_asset_hash: assetFingerprint(source),
      mime_type: typeof source.media_type === "string" ? source.media_type : null,
      materialization: "pending",
      // Raw bytes and URLs stay in the local native snapshot until an authorized
      // attachment materializer creates a normal owned Bucket attachment.
      source_type: typeof source.type === "string" ? source.type : null,
    } };
  }
  const bounded = boundedOutput(raw);
  if (rawType === "tool_use") return { kind: "tool_use", rawType, text: null, payload: {
    ...bounded.payload, truncated: bounded.truncated, redacted: bounded.redacted,
  } };
  if (rawType === "tool_result") {
    const output = boundedOutput(raw.content);
    return { kind: "tool_result", rawType, text: null, payload: {
      tool_use_id: typeof raw.tool_use_id === "string" ? raw.tool_use_id : null,
      is_error: raw.is_error === true,
      structured_output: { ...structuredToolOutput(output.payload), truncated: output.truncated, redacted: output.redacted },
    } };
  }
  return { kind: "unknown", rawType, text: null, payload: bounded };
}

export function projectNativeHistory(snapshot, checkpointId, options) {
  const chain = nativeDisplayChain(snapshot, checkpointId, options);
  const messages = [];
  let assistant = null;
  function createMessage(entry, role) {
    const message = {
      sourceMessageId: entry.uuid,
      parentSourceMessageId: messages.at(-1)?.sourceMessageId ?? null,
      role,
      createdAt: typeof entry.timestamp === "string" ? entry.timestamp : null,
      parentProviderCheckpointId: entry.parentUuid,
      providerCheckpointId: entry.uuid,
      sourceEntryUuids: [],
      blocks: [],
    };
    messages.push(message);
    return message;
  }
  for (const entry of chain) {
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      assistant = null;
      continue;
    }
    const blocks = contentBlocks(entry);
    const internal = entry.isMeta === true || entry.isCompactSummary === true || entry.type === "system" || entry.type === "attachment";
    const toolResponse = entry.type === "user" && blocks.some(block => block?.type === "tool_result");
    if (!internal && entry.type === "user" && !toolResponse) {
      assistant = null;
      const user = createMessage(entry, "user");
      user.sourceEntryUuids.push(entry.uuid);
      user.blocks = blocks.map((block, ordinal) => projectBlock(block, entry, ordinal, snapshot.sessionId));
    } else if (!internal && (entry.type === "assistant" || toolResponse)) {
      assistant ??= createMessage(entry, "assistant");
      assistant.sourceEntryUuids.push(entry.uuid);
      assistant.blocks.push(...blocks.map((block, ordinal) => projectBlock(block, entry, ordinal, snapshot.sessionId)));
      assistant.providerCheckpointId = entry.uuid;
    }
  }
  for (const message of messages) message.fingerprint = fingerprint(message);
  return { schemaVersion: 1, sessionId: snapshot.sessionId, revision: snapshot.revision, checkpointId, messages };
}

// A pure plan, not a database writer. The future writer must compare-and-swap
// expectedRevision and apply all changes atomically. Branch changes are explicit.
export function planNativeHistorySync(previous, next) {
  if (previous) {
    if (previous.sessionId !== next.sessionId || previous.messages.length > next.messages.length || previous.messages.some((message, index) => message.sourceMessageId !== next.messages[index]?.sourceMessageId)) {
      throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    }
  }
  for (const [index, old] of (previous?.messages ?? []).entries()) {
    const fresh = next.messages[index];
    if (old.fingerprint === fresh.fingerprint) continue;
    if (index !== previous.messages.length - 1 || old.role !== "assistant") throw fail("NATIVE_HISTORY_REWRITTEN");
    const base = ({ blocks, sourceEntryUuids, providerCheckpointId, fingerprint, ...rest }) => rest;
    if (!isDeepStrictEqual(base(old), base(fresh)) ||
      old.blocks.length > fresh.blocks.length ||
      !isDeepStrictEqual(old.blocks, fresh.blocks.slice(0, old.blocks.length)) ||
      old.sourceEntryUuids.length > fresh.sourceEntryUuids.length ||
      !isDeepStrictEqual(old.sourceEntryUuids, fresh.sourceEntryUuids.slice(0, old.sourceEntryUuids.length))) {
      throw fail("NATIVE_HISTORY_REWRITTEN");
    }
  }
  const existing = new Map(previous?.messages.map(message => [message.sourceMessageId, message.fingerprint]) ?? []);
  return {
    expectedRevision: previous?.revision ?? null,
    nextRevision: next.revision,
    checkpointId: next.checkpointId,
    upserts: next.messages.filter(message => existing.get(message.sourceMessageId) !== message.fingerprint),
  };
}

// Byte extraction only. Upload/binding must use the existing authenticated
// attachment service later; this helper never reads a path or fetches a URL.
export function extractNativeHistoryAsset(snapshot, reference, { expectedRevision, maxBytes }) {
  if (snapshot.revision !== expectedRevision) throw fail("STALE_NATIVE_SNAPSHOT");
  if (reference?.source_session_id !== snapshot.sessionId) throw fail("STALE_NATIVE_ASSET");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isInteger(reference?.source_block_ordinal) || reference.source_block_ordinal < 0) throw fail("INVALID_NATIVE_ASSET");
  const entry = snapshot.entries.find(entry => entry.uuid === reference.source_entry_uuid && !entry.isSidechain);
  const raw = entry && contentBlocks(entry)[reference.source_block_ordinal];
  if (!["image", "document"].includes(raw?.type) || raw.source?.type !== "base64") throw fail("NATIVE_ASSET_UNAVAILABLE");
  const { data, media_type: mimeType } = raw.source;
  if (typeof data !== "string" || typeof mimeType !== "string" || !mimeType.includes("/")) throw fail("INVALID_NATIVE_ASSET");
  if (data.length > Math.ceil(maxBytes / 3) * 4) throw fail("NATIVE_ASSET_TOO_LARGE");
  if (!data.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw fail("INVALID_NATIVE_ASSET");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maxBytes) throw fail("NATIVE_ASSET_TOO_LARGE");
  if (bytes.toString("base64") !== data) throw fail("INVALID_NATIVE_ASSET");
  if (reference.source_asset_hash !== assetFingerprint(raw.source)) throw fail("STALE_NATIVE_ASSET");
  return { bytes, mimeType, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
