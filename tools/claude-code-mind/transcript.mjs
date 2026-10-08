import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";

export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 512 * 1024;
const READ_ATTEMPTS = 3;
const BOUNDARY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 30;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Observed Claude 2.1.267/2.1.289 attachment.content omits stdout's single transport LF.
// Never trim record content: a trailing LF is accepted only as exactly one transport LF.
export function contextHashMatches(content, expected) {
  return typeof content === "string" && content.length <= 50001 &&
    (sha256(content) === expected || (content.endsWith("</leileios_context>\n") && sha256(content.slice(0, -1)) === expected));
}

async function readTranscriptOnce(path, sessionId, identity) {
  let file;
  try {
    const before = await fs.lstat(path, {bigint: true});
    if (!before.isFile() || identity && (before.dev !== identity.dev || before.ino !== identity.ino || before.size < identity.size)) return {status: "rejected"};
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat({bigint: true});
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size < before.size) return {status: "rejected"};
    const size = Number(stat.size);
    if (!Number.isSafeInteger(size)) return {status: "rejected"};
    const start = Math.max(0, size - MAX_TRANSCRIPT_BYTES);
    const buffer = Buffer.alloc(size - start);
    const {bytesRead} = await file.read(buffer, 0, buffer.length, start);
    const after = await file.stat({bigint: true});
    const named = await fs.lstat(path, {bigint: true});
    if (!named.isFile() || named.dev !== stat.dev || named.ino !== stat.ino || after.size < stat.size || named.size < stat.size) return {status: "rejected"};
    // Claude Desktop appends several records around UserPromptSubmit. A changing
    // file is a transient snapshot race, not evidence that the transcript is bad.
    if (bytesRead !== buffer.length || stat.size !== after.size
      || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs
      || after.size !== named.size || after.mtimeNs !== named.mtimeNs || after.ctimeNs !== named.ctimeNs) {
      return {status: "transient", identity: named};
    }
    // Trim the potentially partial first line as bytes, before strict decoding.
    const newline = start ? buffer.indexOf(10) : -1;
    if (start && newline < 0) return {status: "rejected"};
    const bytes = start ? buffer.subarray(newline + 1) : buffer;
    const lines = []; let offset = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] === 10) {
        lines.push(bytes.subarray(offset, index)); offset = index + 1;
        if (lines.length >= 20000) return {status: "rejected"};
      }
    }
    lines.push(bytes.subarray(offset));
    if (lines.length > 20000) return {status: "rejected"};
    const records = new Map(); let head = null;
    const trailingPartial = bytes.length > 0 && bytes.at(-1) !== 10;
    const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.length) continue;
      if (line.length > MAX_LINE_BYTES) return {status: "rejected"};
      let record;
      try { record = JSON.parse(decoder.decode(line)); }
      catch {
        // A partial UTF-8/JSON tail may complete. Never accept repaired bytes or
        // ignore invalid data; corruption in a newline-terminated line is fatal.
        if (trailingPartial && index === lines.length - 1) return {status: "transient", identity: stat};
        return {status: "rejected"};
      }
      if (!record || typeof record !== "object") return {status: "rejected"};
      if (record.isSidechain === true || record.sessionId !== sessionId || typeof record.uuid !== "string") continue;
      if (!["user", "assistant", "attachment", "system"].includes(record.type)) continue;
      if (records.has(record.uuid)) return {status: "rejected"};
      records.set(record.uuid, record); head = record.uuid;
    }
    return {status: "ok", identity: stat, value: {records, head}};
  } catch {
    return {status: "rejected"};
  } finally {
    await file?.close().catch(() => undefined);
  }
}

// One attempt budget per public operation: boundary retries do not multiply
// snapshot retries. Pin the inode throughout; replacement is never a retry.
async function readWithRetries(path, sessionId, attempts, evaluate, onReason) {
  if (typeof path !== "string" || !path || path.length > 4096) {
    onReason?.("read_rejected"); return null;
  }
  let identity; let lastReason = "read_transient_exhausted";
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await readTranscriptOnce(path, sessionId, identity);
    if (result.status === "rejected") {
      onReason?.("read_rejected"); return null;
    }
    identity = result.identity;
    if (result.status === "ok") {
      const decision = evaluate(result.value);
      if (decision.done) {
        if (decision.value === null && decision.reason) onReason?.(decision.reason);
        return decision.value;
      }
      lastReason = decision.reason || "turn_mismatch";
    } else {
      lastReason = "read_transient_exhausted";
    }
    if (attempt + 1 < attempts) await sleep(RETRY_DELAY_MS);
  }
  onReason?.(lastReason);
  return null;
}
export async function readTranscript(path, sessionId) {
  return readWithRetries(path, sessionId, READ_ATTEMPTS, value => ({done: true, value}));
}

function isPrompt(record) {
  if (record.type !== "user" || record.message?.role !== "user" || record.isMeta === true || record.toolUseResult !== undefined || record.sourceToolAssistantUUID) return false;
  const content = record.message.content;
  return typeof content === "string" || (Array.isArray(content) && content.length > 0 && content.every(b => ["text", "image"].includes(b?.type)));
}
export function currentTurn(transcript) {
  if (!transcript?.head) return null;
  const chain = []; const visited = new Set(); let id = transcript.head;
  while (id && chain.length < 10000) {
    if (visited.has(id)) return null; visited.add(id);
    const record = transcript.records.get(id); if (!record) return null;
    chain.push(record);
    if (isPrompt(record)) return {prompt: record, chain};
    id = record.parentUuid;
  }
  return null;
}
export async function promptAnchor(path, sessionId, prompt, onReason) {
  return readWithRetries(path, sessionId, BOUNDARY_ATTEMPTS, transcript => {
    const turn = currentTurn(transcript);
    if (!turn && transcript.head) return {done: true, value: null, reason: "turn_mismatch"};
    const content = turn?.prompt.message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(b => b.type === "text").map(b => b.text).join("\n") : null;
    // Desktop attaches deferred_tools_delta, total_tokens_reminder and other
    // UserPromptSubmit hook records immediately after the prompt, sometimes
    // before this hook starts. These attachments are not model activity.
    // A completed predecessor with assistant/system activity cannot anchor a
    // repeated identical prompt while the new prompt has not appeared.
    if (turn && turn.chain.slice(0, -1).every(record => record.type === "attachment") && text === prompt) {
      return {done: true, value: turn.prompt.uuid};
    }
    return {done: false, reason: "no_anchor"};
  }, onReason);
}
export async function provesDelivery(path, sessionId, pending) {
  if (!pending.turn_anchor) return false;
  const turn = currentTurn(await readTranscript(path, sessionId));
  if (turn?.prompt.uuid !== pending.turn_anchor) return false;
  return turn.chain.some(record => record.type === "attachment" && record.attachment?.type === "hook_success" &&
    record.attachment.hookEvent === "UserPromptSubmit" && record.attachment.exitCode === 0 &&
    Date.parse(record.timestamp) >= pending.delivered_at && contextHashMatches(record.attachment.content, pending.context_sha256));
}

// Stop is a proposal: the aggregate is written only after all matching hooks resolve.
// A later host boundary (idle, next prompt, session end) is required as well. The
// summary alone precedes other possible continuation paths and is not finality.
export async function provesFinalizedDelivery(path, sessionId, pending, nextPrompt = false, requireDuration = false, onReason) {
  const reject = reason => { onReason?.(reason); return false; };
  if (!pending.turn_anchor) return reject("no_anchor");
  const transcript = await readWithRetries(path, sessionId, nextPrompt ? BOUNDARY_ATTEMPTS : READ_ATTEMPTS, snapshot => {
    const turn = currentTurn(snapshot);
    if (!turn && snapshot.head) return {done: true, value: null, reason: "turn_mismatch"};
    return {done: !nextPrompt || !!turn && turn.prompt.uuid !== pending.turn_anchor, value: snapshot, reason: "turn_mismatch"};
  }, onReason);
  if (!transcript) return false;
  let turn = currentTurn(transcript);
  if (nextPrompt) {
    if (!turn || turn.prompt.uuid === pending.turn_anchor) return reject("turn_mismatch");
    turn = currentTurn({...transcript, head: turn.prompt.parentUuid});
  }
  if (turn?.prompt.uuid !== pending.turn_anchor) return reject("turn_mismatch");
  const index = turn.chain.findIndex(r => r.type === "system" && r.subtype === "stop_hook_summary" && r.hookLabel === undefined);
  if (index < 0) return reject("no_summary");
  if (requireDuration && !turn.chain.slice(0, index).some(r => r.type === "system" && r.subtype === "turn_duration" && Number.isFinite(r.durationMs) && r.durationMs >= 0)) return reject("summary_unclean");
  const summary = turn.chain[index];
  // Do not confuse preventContinuation (continue:false) with decision:block.
  // Both blocking errors and additionalContext are continuation evidence.
  if (summary.preventedContinuation !== false || summary.hasOutput !== false ||
      !Number.isInteger(summary.hookCount) || summary.hookCount < 1 ||
      !Array.isArray(summary.hookErrors) || summary.hookErrors.length ||
      !Array.isArray(summary.hookAdditionalContext) || summary.hookAdditionalContext.length ||
      Date.parse(summary.timestamp) < pending.delivered_at || !Number.isFinite(Date.parse(summary.timestamp))) return reject("summary_unclean");
  // Fail closed on activity after this Stop, including API errors, tool calls,
  // TaskCompleted/TeammateIdle feedback and cancellation attachments.
  if (turn.chain.slice(0, index).some(r => !(r.type === "system" && r.subtype === "turn_duration"))) return reject("summary_unclean");
  if (!turn.chain.slice(index + 1).some(record => record.type === "attachment" && record.attachment?.type === "hook_success" &&
    record.attachment.hookEvent === "UserPromptSubmit" && record.attachment.exitCode === 0 &&
    Date.parse(record.timestamp) >= pending.delivered_at && contextHashMatches(record.attachment.content, pending.context_sha256))) return reject("hash_mismatch");
  return true;
}