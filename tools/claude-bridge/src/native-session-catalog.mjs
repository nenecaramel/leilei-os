import { constants } from "node:fs";
import { open, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { durableCheckpointPrefix } from "./provider-checkpoint-prefix.mjs";

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const carrierTypes = new Set(["user", "assistant", "system", "attachment"]);
const failure = code => Object.assign(new Error(code), { code });
const stamp = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;

// Never opens a transcript for writing or invokes the SDK. A snapshot is an
// observation, not an execution lease or proof that the producer is idle.
export async function readNativeSession(projectDirectory, sessionId, { maxBytes = 64 * 1024 * 1024 } = {}) {
  if (!sessionPattern.test(sessionId)) throw failure("INVALID_SESSION_ID");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw failure("INVALID_READ_LIMIT");
  const file = path.join(projectDirectory, `${sessionId}.jsonl`);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw failure("INVALID_TRANSCRIPT_FILE");
    if (before.size > BigInt(maxBytes)) throw failure("TRANSCRIPT_TOO_LARGE");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    if (stamp(before) !== stamp(after) || stamp(after) !== stamp(named) || length !== Number(before.size)) throw failure("TRANSCRIPT_CHANGED_DURING_READ");
    const bytes = buffer.subarray(0, length);
    let entries;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      entries = text.split("\n").filter(line => line.trim()).map(line => {
        const entry = JSON.parse(line);
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw failure("INVALID_TRANSCRIPT");
        return entry;
      });
    } catch {
      throw failure("INVALID_TRANSCRIPT");
    }
    return { sessionId, file, revision: createHash("sha256").update(bytes).digest("hex"), entries };
  } finally {
    await handle.close();
  }
}

export function readNativeBranch(snapshot, checkpointId) {
  return durableCheckpointPrefix(snapshot.entries, checkpointId).prefix;
}

function summarize(snapshot) {
  const carriers = new Map();
  const parents = new Set();
  const recordTypes = Object.create(null);
  const workingDirectories = new Set();
  const embeddedSessionIds = new Set();
  for (const entry of snapshot.entries) {
    const type = typeof entry.type === "string" ? entry.type : "unknown";
    recordTypes[type] = (Object.hasOwn(recordTypes, type) ? recordTypes[type] : 0) + 1;
    if (typeof entry.cwd === "string") workingDirectories.add(entry.cwd);
    if (typeof entry.sessionId === "string") embeddedSessionIds.add(entry.sessionId);
    if (!entry.isSidechain && carrierTypes.has(entry.type) && typeof entry.uuid === "string" && Object.hasOwn(entry, "parentUuid")) {
      carriers.set(entry.uuid, entry);
      if (typeof entry.parentUuid === "string") parents.add(entry.parentUuid);
    }
  }
  const reachable = new Set();
  const branches = [];
  for (const checkpointId of carriers.keys()) {
    if (parents.has(checkpointId)) continue;
    try {
      const { ancestry } = durableCheckpointPrefix(snapshot.entries, checkpointId);
      for (const uuid of ancestry) reachable.add(uuid);
      branches.push({ checkpointId, valid: true, entryCount: ancestry.size });
    } catch {
      branches.push({ checkpointId, valid: false, error: "INVALID_CHECKPOINT_ANCESTRY" });
    }
  }
  const diagnostics = [];
  if (!carriers.size) diagnostics.push("NO_CHECKPOINT_CARRIERS");
  if ([...carriers.keys()].some(uuid => !reachable.has(uuid))) diagnostics.push("CYCLIC_OR_UNREACHABLE_RECORDS");
  return {
    sessionId: snapshot.sessionId, file: snapshot.file, revision: snapshot.revision,
    workingDirectories: [...workingDirectories], embeddedSessionIds: [...embeddedSessionIds],
    entryCount: snapshot.entries.length, recordTypes, branches, diagnostics,
    // JSONL leaf order and mtime cannot identify the Desktop-selected branch.
    currentHead: null, activity: "unknown",
  };
}

export async function listNativeSessions(projectsDirectory, options = {}) {
  const sessions = [];
  const projects = await readdir(projectsDirectory, { withFileTypes: true });
  for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!project.isDirectory()) continue;
    const directory = path.join(projectsDirectory, project.name);
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const sessionId = file.name.slice(0, -6);
      if (!sessionPattern.test(sessionId)) continue;
      try {
        sessions.push({ project: project.name, ...summarize(await readNativeSession(directory, sessionId, options)) });
      } catch (error) {
        sessions.push({ project: project.name, sessionId, error: ["INVALID_TRANSCRIPT", "TRANSCRIPT_TOO_LARGE", "TRANSCRIPT_CHANGED_DURING_READ"].includes(error.code) ? error.code : "TRANSCRIPT_UNREADABLE" });
      }
    }
  }
  return sessions;
}
