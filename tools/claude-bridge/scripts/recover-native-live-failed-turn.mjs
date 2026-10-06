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

  const store = new RemoteSessionStore(client);
  await importSessionToStore(
    sessionId,
    store,
    {
      dir: workingDirectory,
      includeSubagents: true,
      batchSize: 500,
    },
  );

  const transcript = await store.load({
    projectKey: workingDirectory,
    sessionId,
  });
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error(
      "Local transcript backfill produced no readable remote transcript.",
    );
  }
  await store.markComplete(sessionId);

  process.stdout.write(
    JSON.stringify({
      outcome: "provider_transcript_backfilled",
      prepareId,
      sessionId,
      entryCount: transcript.length,
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
