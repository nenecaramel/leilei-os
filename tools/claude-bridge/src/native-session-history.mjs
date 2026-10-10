import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { boundedOutput, isReasoning, structuredToolOutput } from "./output-contract.mjs";

const carrierTypes = new Set(["user", "assistant", "system", "attachment"]);
const fail = code => Object.assign(new Error(code), { code });
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

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
      source_session_id: sessionId, source_asset_hash: fingerprint(source),
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

export function projectNativeHistory(snapshot, checkpointId) {
  const chain = displayChain(snapshot, checkpointId);
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
  if (reference.source_asset_hash !== fingerprint(raw.source)) throw fail("STALE_NATIVE_ASSET");
  return { bytes, mimeType, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
