import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, TextDecoder } from "node:util";
import path from "node:path";
import { readOnlyFileSnapshot } from "./read-only-file-snapshot.mjs";

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const unknown = reason => ({ state: "unknown", reason, isWriteLease: false });
const executeFile = promisify(execFile);

export async function probeNativeProcessStart(pid, execute = executeFile) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("INVALID_NATIVE_PID");
  const { stdout } = await execute("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" }, timeout: 2000, maxBuffer: 4096,
  });
  return stdout.trim() || null;
}

export async function readNativeSessionActivity(directory, sessionId, { probeProcessStart = probeNativeProcessStart } = {}) {
  if (!uuid(sessionId)) return unknown("INVALID_ACTIVITY_INPUT");
  const records = [];
  try {
    const files = await readdir(directory, { withFileTypes: true });
    const peers = files.filter(file => /^[1-9][0-9]*\.json$/.test(file.name));
    if (peers.length > 1000) return unknown("NATIVE_OWNER_SCAN_LIMIT");
    for (const file of peers.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!file.isFile()) return unknown("UNSAFE_NATIVE_OWNER_FILE");
      const filename = path.join(directory, file.name);
      const { bytes } = await readOnlyFileSnapshot(filename, 65536);
      const record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!record || Array.isArray(record) || typeof record !== "object" || record.pid !== Number(file.name.slice(0, -5))) return unknown("INVALID_NATIVE_OWNER_FILE");
      records.push(record);
    }
  } catch { return unknown("NATIVE_OWNER_FILES_UNAVAILABLE"); }
  return observeNativeSessionActivity(sessionId, records, probeProcessStart);
}

// Native peer records are observations, never an atomic handoff/ownership lease.
// Whitelist output fields: records may also contain IPC credentials and paths.
export async function observeNativeSessionActivity(sessionId, records, probeProcessStart) {
  if (!uuid(sessionId) || !Array.isArray(records) || typeof probeProcessStart !== "function") return unknown("INVALID_ACTIVITY_INPUT");
  const candidates = records.filter(record => record?.sessionId === sessionId);
  if (candidates.length === 0) return unknown("NATIVE_OWNER_UNAVAILABLE");
  const owners = [];
  for (const record of candidates) {
    if (record.pidDomain !== "darwin" || record.peerProtocol !== 1 ||
        !Number.isSafeInteger(record.pid) || record.pid <= 0 ||
        typeof record.procStart !== "string" || !record.procStart.trim() ||
        typeof record.status !== "string") return unknown("UNSUPPORTED_NATIVE_OWNER");
    let processStart;
    try { processStart = await probeProcessStart(record.pid); }
    catch { return unknown("NATIVE_OWNER_PROBE_FAILED"); }
    if (processStart !== record.procStart) return unknown("NATIVE_OWNER_IDENTITY_UNCONFIRMED");
    owners.push(record);
  }
  if (owners.length !== 1) return unknown("MULTIPLE_NATIVE_WRITERS");
  const owner = owners[0];
  return {
    state: owner.status === "idle" ? "idle_observed" : "busy_or_unknown",
    ownerPid: owner.pid,
    isWriteLease: false,
  };
}
