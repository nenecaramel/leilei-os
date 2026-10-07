import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";

export const MAX_TRANSCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 512 * 1024;
const sha256 = value => createHash("sha256").update(value).digest("hex");

// Observed Claude 2.1.267/2.1.289 attachment.content omits stdout's single transport LF.
// Never trim record content: a trailing LF is accepted only as exactly one transport LF.
export function contextHashMatches(content, expected) {
  return typeof content === "string" && content.length <= 50001 &&
    (sha256(content) === expected || (content.endsWith("</leileios_context>\n") && sha256(content.slice(0, -1)) === expected));
}

export async function readTranscript(path, sessionId) {
  if (typeof path !== "string" || !path || path.length > 4096) return null;
  let file;
  try {
    file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat(); if (!stat.isFile()) return null;
    const start = Math.max(0, stat.size - MAX_TRANSCRIPT_BYTES);
    const buffer = Buffer.alloc(stat.size - start);
    const {bytesRead} = await file.read(buffer, 0, buffer.length, start);
    const after = await file.stat();
    if (bytesRead !== buffer.length || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) return null;
    let text = buffer.toString("utf8");
    if (start) { const newline = text.indexOf("\n"); if (newline < 0) return null; text = text.slice(newline + 1); }
    const lines = text.split("\n"); if (lines.length > 20000) return null;
    const records = new Map(); let head = null;
    for (const line of lines) {
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) return null;
      let record; try { record = JSON.parse(line); } catch { return null; }
      if (!record || typeof record !== "object") return null;
      if (record.isSidechain === true || record.sessionId !== sessionId || typeof record.uuid !== "string") continue;
      if (!["user", "assistant", "attachment", "system"].includes(record.type)) continue;
      if (records.has(record.uuid)) return null;
      records.set(record.uuid, record); head = record.uuid;
    }
    return {records, head};
  } catch { return null; }
  finally { await file?.close().catch(() => undefined); }
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
export async function promptAnchor(path, sessionId, prompt) {
  const turn = currentTurn(await readTranscript(path, sessionId));
  const content = turn?.prompt.message.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter(b => b.type === "text").map(b => b.text).join("\n") : null;
  return text === prompt ? turn.prompt.uuid : null;
}
export async function provesDelivery(path, sessionId, pending) {
  if (!pending.turn_anchor) return false;
  const turn = currentTurn(await readTranscript(path, sessionId));
  if (turn?.prompt.uuid !== pending.turn_anchor) return false;
  return turn.chain.some(record => record.type === "attachment" && record.attachment?.type === "hook_success" &&
    record.attachment.hookEvent === "UserPromptSubmit" && record.attachment.exitCode === 0 &&
    Date.parse(record.timestamp) >= pending.delivered_at && contextHashMatches(record.attachment.content, pending.context_sha256));
}
