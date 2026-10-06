import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { importSessionToStore } from "@anthropic-ai/claude-agent-sdk";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_APPEND_CHUNK_BYTES = 6_000_000;
async function main(argv = process.argv.slice(2)) {
  const prepareId =
    argv.find((value) => value !== "--")?.trim() ?? "";

  if (!UUID.test(prepareId)) {
    throw new Error(
      "Usage: pnpm runtime:native-live-recover-failed-turn -- <prepare-id>",
    );
  }

  const repoRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const railway = loadRailwayVariables(repoRoot);
  const relayBaseUrl = firstNonBlank(
    process.env.LEILEI_NATIVE_LIVE_RELAY_URL,
    process.env.MCP_SERVER_URL,
    railway.MCP_SERVER_URL,
  ) ?? "https://leilei-os-production.up.railway.app";
  const relayToken = firstNonBlank(
    process.env.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
    railway.NATIVE_LIVE_RELAY_AUTH_TOKEN,
  );
  if (!relayToken) {
    throw new Error(
      "Native Live relay token is unavailable. Link/authenticate Railway CLI or set LEILEI_NATIVE_LIVE_RELAY_TOKEN.",
    );
  }

  const client = new InternalClient(relayBaseUrl, relayToken);
  const inspection = await client.post(
    `/internal/native-live-relay/failed-turn-recovery/${prepareId}/inspect`,
    {},
  );
  if (inspection.recoverable !== true) {
    throw new Error("The failed turn is not recoverable.");
  }
  const sessionId = stringField(
    inspection.providerSessionId,
    "providerSessionId",
  );
  const workingDirectory =
    nonblank(inspection.expectedWorkingDirectory)
    ?? nonblank(process.env.LEILEI_NATIVE_LIVE_WORKING_DIRECTORY)
    ?? homedir();

  process.stdout.write(
    JSON.stringify({
      outcome: "failed_turn_recovery_inspected",
      prepareId,
      sessionId,
      workingDirectory,
      eventCount: inspection.eventCount,
    }) + "\n",
  );

  const capture = new CaptureSessionStore();
  let localSessionScope = workingDirectory;
  try {
    await importSessionToStore(
      sessionId,
      capture,
      {
        dir: workingDirectory,
        includeSubagents: true,
        batchSize: 500,
      },
    );
  } catch (scopedCause) {
    if (
      !String(
        scopedCause instanceof Error
          ? scopedCause.message
          : scopedCause,
      ).includes("Session " + sessionId + " not found")
    ) {
      throw scopedCause;
    }
    await capture.clear();
    await importSessionToStore(
      sessionId,
      capture,
      {
        includeSubagents: true,
        batchSize: 500,
      },
    );
    localSessionScope = "all_project_directories";
  }

  const sessionKey = {
    projectKey: workingDirectory,
    sessionId,
  };
  const capturedTranscript = await capture.load(sessionKey);
  if (
    !Array.isArray(capturedTranscript)
    || capturedTranscript.length === 0
  ) {
    throw new Error(
      "Local Claude transcript could not be captured; remote state was not changed.",
    );
  }

  const store = new RemoteSessionStore(client);
  await store.delete(sessionKey);
  await store.markIncomplete(sessionId);
  await replayCapturedSession(capture, store, sessionKey);
  await verifyCapturedSession(capture, store, sessionKey);
  await store.markComplete(sessionId);

  process.stdout.write(
    JSON.stringify({
      outcome: "provider_transcript_rebuilt",
      prepareId,
      sessionId,
      entryCount: capturedTranscript.length,
      subkeyCount: (
        await capture.listSubkeys(sessionKey)
      ).length,
      localSessionScope,
    }) + "\n",
  );

  const recovered = await client.post(
    `/internal/native-live-relay/failed-turn-recovery/${prepareId}/recover`,
    {},
  );
  process.stdout.write(
    JSON.stringify({
      outcome: "failed_turn_recovered",
      prepareId,
      conversationId: recovered.conversationId,
      assistantMessageId: recovered.assistantMessageId,
      providerSessionId: recovered.providerSessionId,
      providerCheckpointId: recovered.providerCheckpointId,
    }) + "\n",
  );
}

class InternalClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/u, "");
    this.token = token;
  }

  async post(path, body) {
    const response = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: {
        authorization: "Bearer " + this.token,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        `Internal recovery endpoint returned malformed JSON (${response.status}).`,
      );
    }
    if (
      !response.ok
      || !payload
      || typeof payload !== "object"
      || payload.success !== true
    ) {
      const code =
        payload?.error?.code
        && typeof payload.error.code === "string"
          ? payload.error.code
          : "UNKNOWN";
      const message =
        payload?.error?.message
        && typeof payload.error.message === "string"
          ? payload.error.message
          : "Internal recovery request failed.";
      throw new Error(`${code}: ${message}`);
    }
    return payload.data;
  }
}

class CaptureSessionStore {
  constructor() {
    this.entries = new Map();
  }

  async clear() {
    this.entries.clear();
  }

  async append(key, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const storageKey = captureStorageKey(key);
    const current = this.entries.get(storageKey) ?? [];
    this.entries.set(storageKey, [...current, ...entries]);
  }

  async load(key) {
    const entries = this.entries.get(captureStorageKey(key));
    return entries ? [...entries] : null;
  }

  async listSubkeys({ sessionId }) {
    const prefix = sessionId + "\u0000";
    return [...this.entries.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter(Boolean)
      .sort();
  }
}

class RemoteSessionStore {
  constructor(client) {
    this.client = client;
  }

  async append(key, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    for (const chunk of chunkEntries(entries)) {
      await this.client.post(
        "/internal/native-live-session-store/append",
        {
          key: remoteKey(key),
          append_batch_id: randomUUID(),
          entries: chunk,
        },
      );
    }
  }

  async load(key) {
    const data = await this.client.post(
      "/internal/native-live-session-store/load",
      { key: remoteKey(key) },
    );
    return data.entries;
  }

  async delete(key) {
    await this.client.post(
      "/internal/native-live-session-store/delete",
      { key: remoteKey(key) },
    );
  }

  async markComplete(sessionId) {
    await this.client.post(
      "/internal/native-live-session-store/mark-complete",
      { session_id: sessionId },
    );
  }

  async markIncomplete(sessionId) {
    await this.client.post(
      "/internal/native-live-session-store/mark-incomplete",
      { session_id: sessionId },
    );
  }

  async getStatus(sessionId) {
    const data = await this.client.post(
      "/internal/native-live-session-store/status",
      { session_id: sessionId },
    );
    return data.state;
  }

  async listSubkeys({ sessionId }) {
    const data = await this.client.post(
      "/internal/native-live-session-store/list-subkeys",
      { session_id: sessionId },
    );
    return data.subkeys;
  }
}

async function replayCapturedSession(
  capture,
  remote,
  sessionKey,
) {
  const main = await capture.load(sessionKey);
  if (main?.length) {
    await remote.append(sessionKey, main);
  }
  const subkeys = await capture.listSubkeys(sessionKey);
  for (const subpath of subkeys) {
    const key = { ...sessionKey, subpath };
    const entries = await capture.load(key);
    if (entries?.length) {
      await remote.append(key, entries);
    }
  }
}

async function verifyCapturedSession(
  capture,
  remote,
  sessionKey,
) {
  const expectedMain = await capture.load(sessionKey);
  const actualMain = await remote.load(sessionKey);
  assertTranscriptEqual(
    actualMain,
    expectedMain,
    "main transcript",
  );

  const expectedSubkeys =
    await capture.listSubkeys(sessionKey);
  const actualSubkeys =
    (await remote.listSubkeys(sessionKey)).slice().sort();
  if (
    JSON.stringify(actualSubkeys)
    !== JSON.stringify(expectedSubkeys)
  ) {
    throw new Error(
      "Remote SessionStore subkeys do not match local Claude transcript.",
    );
  }
  for (const subpath of expectedSubkeys) {
    const key = { ...sessionKey, subpath };
    assertTranscriptEqual(
      await remote.load(key),
      await capture.load(key),
      "subagent transcript " + subpath,
    );
  }
}

function assertTranscriptEqual(actual, expected, label) {
  if (
    !Array.isArray(actual)
    || !Array.isArray(expected)
    || actual.length !== expected.length
  ) {
    throw new Error(
      "Remote " + label + " length does not match local Claude transcript.",
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (
      canonicalJson(actual[index])
      !== canonicalJson(expected[index])
    ) {
      throw new Error(
        "Remote " + label + " differs from local Claude transcript at entry "
          + index + ".",
      );
    }
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      )
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}

function captureStorageKey(key) {
  return stringField(key?.sessionId, "sessionId")
    + "\u0000"
    + (
      key?.subpath === undefined
        ? ""
        : stringField(key.subpath, "subpath")
    );
}

function remoteKey(key) {
  return {
    session_id: stringField(key?.sessionId, "sessionId"),
    ...(key?.subpath === undefined
      ? {}
      : { subpath: stringField(key.subpath, "subpath") }),
  };
}

function chunkEntries(entries) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(
      JSON.stringify(entry),
      "utf8",
    );
    if (
      chunk.length > 0
      && bytes + entryBytes > MAX_APPEND_CHUNK_BYTES
    ) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(entry);
    bytes += entryBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function loadRailwayVariables(cwd) {
  try {
    const raw = execFileSync(
      "railway",
      [
        "variable",
        "list",
        "--service",
        "leilei-os",
        "--environment",
        "production",
        "--json",
      ],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsed = JSON.parse(raw);
    const output = {};
    collectStrings(parsed, output);
    return output;
  } catch {
    return {};
  }
}

function collectStrings(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const key of [
    "MCP_SERVER_URL",
    "NATIVE_LIVE_RELAY_AUTH_TOKEN",
  ]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      output[key] = candidate.trim();
    }
  }

  const name =
    typeof value.name === "string"
      ? value.name
      : typeof value.key === "string"
        ? value.key
        : null;
  const variableValue =
    typeof value.value === "string"
      ? value.value
      : null;
  if (
    name
    && variableValue
    && (
      name === "MCP_SERVER_URL"
      || name === "NATIVE_LIVE_RELAY_AUTH_TOKEN"
    )
  ) {
    output[name] = variableValue.trim();
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") {
      collectStrings(nested, output);
    }
  }
}

function firstNonBlank(...values) {
  for (const value of values) {
    const normalized = nonblank(value);
    if (normalized) return normalized;
  }
  return null;
}

function nonblank(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function stringField(value, name) {
  const normalized = nonblank(value);
  if (!normalized) {
    throw new Error(`Recovery ${name} is missing.`);
  }
  return normalized;
}


await main();
