import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import "dotenv/config";
import {
  resolveNativeLiveMacDaemonConfig,
} from "../src/domains/bridge/mac/native-live-mac-daemon-config.js";
import {
  NativeLiveMacProviderSessionStore,
} from "../src/domains/bridge/mac/native-live-mac-provider-session-store.js";
import {
  durableCheckpointPrefix,
} from "../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";

type Leaf = {
  conversation_id: string;
  title: string | null;
  updated_at: string;
  provider_session_id: string;
  provider_checkpoint_id: string;
  effective_working_directory: string;
};

type SessionEntry = Record<string, unknown> & {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
};

const apply = process.argv.includes("--apply");
const expectedConversation = argument("--expect-conversation");
const expectedCheckpoint = argument("--expect-checkpoint");

const appVariables = loadRailwayVariables("leilei-os");
const postgresVariables = loadRailwayVariables("Postgres");
const databaseUrl =
  firstNonblank(
    process.env.DATABASE_URL,
    postgresVariables.DATABASE_PUBLIC_URL,
    appVariables.DATABASE_URL,
    postgresVariables.DATABASE_URL,
  );
const userId =
  firstNonblank(
    process.env.MCP_USER_ID,
    appVariables.MCP_USER_ID,
  );

if (!databaseUrl) {
  throw new Error(
    "Production DATABASE_URL is unavailable. Authenticate/link the Railway CLI or set DATABASE_URL explicitly.",
  );
}
if (!userId) {
  throw new Error(
    "MCP_USER_ID is unavailable. Authenticate/link the Railway CLI or set MCP_USER_ID explicitly.",
  );
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 5,
  idle_timeout: 5,
});

let leaf: Leaf;
try {
  const rows = await sql<Leaf[]>`
    SELECT
      c.id::text AS conversation_id,
      c.title,
      c.updated_at::text AS updated_at,
      p.provider_session_id,
      p.provider_checkpoint_id,
      p.effective_working_directory
    FROM conversations c
    JOIN conversation_provider_session_checkpoints p
      ON p.user_id = c.user_id
      AND p.conversation_id = c.id
      AND p.canonical_message_id = c.current_head_message_id
      AND p.provider = 'claude_code'
    WHERE c.user_id = ${userId}::uuid
      AND c.origin = 'native_live'
      AND c.lifecycle_status = 'active'
      AND c.current_head_message_id IS NOT NULL
      AND p.provider_checkpoint_id IS NOT NULL
      AND p.effective_working_directory IS NOT NULL
    ORDER BY c.updated_at DESC, p.created_at DESC
    LIMIT 1
  `;
  const current = rows[0];
  if (!current) {
    throw new Error(
      "No active Native Live conversation leaf with a Claude checkpoint was found.",
    );
  }
  leaf = current;
} finally {
  await sql.end({ timeout: 1 });
}

if (apply) {
  if (!expectedConversation || !expectedCheckpoint) {
    throw new Error(
      "--apply requires --expect-conversation and --expect-checkpoint from the dry-run output.",
    );
  }
  if (
    expectedConversation !== leaf.conversation_id
    || expectedCheckpoint !== leaf.provider_checkpoint_id
  ) {
    throw new Error(
      "Current conversation leaf changed since dry-run; refusing to overwrite the local transcript.",
    );
  }
}

const localEntries = await readLocalEntriesWithInstalledSdk({
  sessionId: leaf.provider_session_id,
  workingDirectory: leaf.effective_working_directory,
});

let sourceEntries = localEntries;
let sourceStorage = "local_sdk";
let verified = checkpointPrefixOrNull(
  sourceEntries,
  leaf.provider_checkpoint_id,
);

if (!verified) {
  const daemonConfig = resolveNativeLiveMacDaemonConfig(
    process.env,
    undefined,
    () => appVariables,
  );
  const store = new NativeLiveMacProviderSessionStore(
    daemonConfig.relayBaseUrl,
    daemonConfig.relayToken,
  );
  const remoteEntries = await store.load({
    projectKey: leaf.effective_working_directory,
    sessionId: leaf.provider_session_id,
  });
  sourceEntries =
    Array.isArray(remoteEntries) ? remoteEntries : [];
  sourceStorage = "remote_store";
  verified = checkpointPrefixOrNull(
    sourceEntries,
    leaf.provider_checkpoint_id,
  );
}

if (!verified) {
  throw new Error(
    "Neither the local Claude transcript nor the remote SessionStore contains the current canonical checkpoint.",
  );
}

const {
  prefix,
  ancestry,
} = verified;

const lastCanonical = [...prefix]
  .reverse()
  .find((entry) => isChainEntry(entry));
if (lastCanonical?.uuid !== leaf.provider_checkpoint_id) {
  throw new Error(
    "Canonical prefix does not end at the selected provider checkpoint.",
  );
}

const target = localTranscriptPath(
  leaf.effective_working_directory,
  leaf.provider_session_id,
);
const existingLocalBytes =
  existsSync(target) ? statSync(target).size : 0;
const encoded =
  prefix.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
const encodedBytes = Buffer.byteLength(encoded, "utf8");

const report = {
  mode: apply ? "apply" : "dry_run",
  conversationId: leaf.conversation_id,
  title: leaf.title,
  conversationUpdatedAt: leaf.updated_at,
  providerSessionId: leaf.provider_session_id,
  providerCheckpointId: leaf.provider_checkpoint_id,
  effectiveWorkingDirectory: leaf.effective_working_directory,
  sourceStorage,
  sourceEntries: sourceEntries.length,
  canonicalPrefixEntries: prefix.length,
  canonicalAncestryEntries: ancestry.size,
  canonicalPrefixBytes: encodedBytes,
  localTarget: target,
  existingLocalBytes,
};

if (!apply) {
  process.stdout.write(
    JSON.stringify(
      {
        ...report,
        validation: {
          durableCheckpointPrefix: "passed",
          canonicalTailMatchesCheckpoint: "passed",
        },
        nextCommand:
          "pnpm runtime:native-live-restore-current-session-local -- --apply"
          + " --expect-conversation " + leaf.conversation_id
          + " --expect-checkpoint " + leaf.provider_checkpoint_id,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}

mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const backup =
  existsSync(target)
    ? target + ".pre-local-cutover-" + stamp + ".bak"
    : null;
if (backup) copyFileSync(target, backup);

const temporary = target + "." + process.pid + ".tmp";
const fd = openSync(temporary, "wx", 0o600);
try {
  writeFileSync(fd, encoded, "utf8");
  fsyncSync(fd);
} finally {
  closeSync(fd);
}

try {
  renameSync(temporary, target);
  fsyncDirectory(dirname(target));
  const sdkValidation = await validateWithInstalledSdk({
    sessionId: leaf.provider_session_id,
    checkpointId: leaf.provider_checkpoint_id,
    workingDirectory: leaf.effective_working_directory,
  });
  process.stdout.write(
    JSON.stringify(
      {
        ...report,
        backup,
        validation: {
          durableCheckpointPrefix: "passed",
          canonicalTailMatchesCheckpoint: "passed",
          sdkGetSessionMessages: "passed",
          sdkImportSessionToStore: "passed",
          localCheckpointPreflight: "passed",
          ...sdkValidation,
        },
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  if (backup) {
    copyFileSync(backup, target);
  } else if (existsSync(target)) {
    unlinkSync(target);
  }
  fsyncDirectory(dirname(target));
  throw error;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(name + " requires a value.");
  }
  return value;
}

function loadRailwayVariables(service: string): Record<string, string> {
  try {
    const output = execFileSync(
      "railway",
      [
        "variable",
        "list",
        "--service",
        service,
        "--environment",
        "production",
        "--json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const result: Record<string, string> = {};
    collectVariables(JSON.parse(output), result);
    return result;
  } catch {
    return {};
  }
}

function collectVariables(
  value: unknown,
  result: Record<string, string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectVariables(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (typeof candidate === "string" && candidate.trim()) {
      if (/^[A-Z][A-Z0-9_]+$/u.test(key)) {
        result[key] = candidate.trim();
      }
    }
  }
  const name =
    typeof record.name === "string"
      ? record.name.trim()
      : typeof record.key === "string"
        ? record.key.trim()
        : "";
  const candidate =
    typeof record.value === "string"
      ? record.value.trim()
      : "";
  if (name && candidate) result[name] = candidate;
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectVariables(nested, result);
    }
  }
}

function firstNonblank(
  ...values: Array<string | undefined>
): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function localTranscriptPath(
  workingDirectory: string,
  sessionId: string,
): string {
  const configDirectory =
    firstNonblank(process.env.CLAUDE_CONFIG_DIR)
    ?? join(homedir(), ".claude");
  const projectKey = workingDirectory.replace(/\//gu, "-");
  return join(resolve(configDirectory), "projects", projectKey, sessionId + ".jsonl");
}

function isChainEntry(entry: SessionEntry): boolean {
  return Boolean(
    entry
    && !entry.isSidechain
    && ["user", "assistant", "system", "attachment"].includes(entry.type)
    && typeof entry.uuid === "string"
    && Object.hasOwn(entry, "parentUuid"),
  );
}

function fsyncDirectory(directory: string): void {
  const directoryFd = openSync(directory, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
}

function checkpointPrefixOrNull(
  entries: SessionEntry[],
  checkpointId: string,
): {
  prefix: SessionEntry[];
  ancestry: Set<string>;
} | null {
  if (entries.length === 0) return null;
  try {
    return durableCheckpointPrefix(
      entries,
      checkpointId,
    ) as {
      prefix: SessionEntry[];
      ancestry: Set<string>;
    };
  } catch {
    return null;
  }
}

async function readLocalEntriesWithInstalledSdk(input: {
  sessionId: string;
  workingDirectory: string;
}): Promise<SessionEntry[]> {
  const bridgeRequire = createRequire(
    new URL("../tools/claude-bridge/package.json", import.meta.url),
  );
  const sdkEntry =
    bridgeRequire.resolve("@anthropic-ai/claude-agent-sdk");
  const sdk = await import(pathToFileURL(sdkEntry).href);
  if (typeof sdk.importSessionToStore !== "function") {
    throw new Error(
      "Installed Claude Agent SDK does not expose importSessionToStore().",
    );
  }

  const imported: SessionEntry[] = [];
  try {
    await sdk.importSessionToStore(
      input.sessionId,
      {
        async append(
          key: { subpath?: string },
          batch: SessionEntry[],
        ) {
          if (!key.subpath) imported.push(...batch);
        },
        async load() {
          return null;
        },
      },
      {
        dir: input.workingDirectory,
        includeSubagents: false,
        batchSize: 500,
      },
    );
  } catch {
    return [];
  }
  return imported;
}

async function validateWithInstalledSdk(input: {
  sessionId: string;
  checkpointId: string;
  workingDirectory: string;
}) {
  const bridgeRequire = createRequire(
    new URL("../tools/claude-bridge/package.json", import.meta.url),
  );
  const sdkEntry = bridgeRequire.resolve("@anthropic-ai/claude-agent-sdk");
  const sdk = await import(pathToFileURL(sdkEntry).href);
  if (
    typeof sdk.getSessionMessages !== "function"
    || typeof sdk.importSessionToStore !== "function"
  ) {
    throw new Error(
      "Installed Claude Agent SDK does not expose the local session validation helpers.",
    );
  }

  const messages = await sdk.getSessionMessages(
    input.sessionId,
    {
      dir: input.workingDirectory,
      limit: 1,
    },
  );
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error(
      "Claude Agent SDK cannot read the restored local session.",
    );
  }

  const imported = await readLocalEntriesWithInstalledSdk(input);
  if (imported.length === 0) {
    throw new Error(
      "Claude Agent SDK could not import the restored local transcript.",
    );
  }

  const importedPrefix = durableCheckpointPrefix(
    imported,
    input.checkpointId,
  ) as {
    prefix: SessionEntry[];
    ancestry: Set<string>;
  };
  const importedTail = [...importedPrefix.prefix]
    .reverse()
    .find((entry) => isChainEntry(entry));
  if (
    importedTail?.uuid !== input.checkpointId
    || !importedPrefix.ancestry.has(input.checkpointId)
  ) {
    throw new Error(
      "Restored local transcript does not pass exact checkpoint preflight.",
    );
  }

  return {
    sdkVisibleMessages: messages.length,
    sdkImportedEntries: imported.length,
    sdkCanonicalAncestryEntries: importedPrefix.ancestry.size,
  };
}
