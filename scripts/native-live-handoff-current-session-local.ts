import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
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

type ClaudeSdk = {
  forkSession(
    sessionId: string,
    options: {
      dir: string;
      upToMessageId: string;
    },
  ): Promise<{ sessionId: string }>;
  getSessionMessages(
    sessionId: string,
    options: { dir: string; limit: number },
  ): Promise<unknown[]>;
  importSessionToStore(
    sessionId: string,
    store: {
      append(
        key: { subpath?: string },
        batch: SessionEntry[],
      ): Promise<void>;
      load(): Promise<null>;
    },
    options: {
      dir: string;
      includeSubagents: boolean;
      batchSize: number;
    },
  ): Promise<void>;
};

const apply = process.argv.includes("--apply");
const expectedConversation = argument("--expect-conversation");
const expectedCheckpoint = argument("--expect-checkpoint");

const appVariables = loadRailwayVariables("leilei-os");
const postgresVariables = loadRailwayVariables("Postgres");
const databaseUrl = firstNonblank(
  process.env.DATABASE_URL,
  postgresVariables.DATABASE_PUBLIC_URL,
  appVariables.DATABASE_URL,
  postgresVariables.DATABASE_URL,
);
const userId = firstNonblank(
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

const leaf = await readCurrentLeaf(databaseUrl, userId);

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
      "Current conversation leaf changed since dry-run; refusing to fork a stale checkpoint.",
    );
  }
}

const sdk = await loadInstalledSdk();
const localEntries = await importLocalEntries(
  sdk,
  leaf.provider_session_id,
  leaf.effective_working_directory,
);

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
  const remoteStore = new NativeLiveMacProviderSessionStore(
    daemonConfig.relayBaseUrl,
    daemonConfig.relayToken,
  );
  const remoteEntries = await remoteStore.load({
    projectKey: leaf.effective_working_directory,
    sessionId: leaf.provider_session_id,
  });
  sourceEntries = Array.isArray(remoteEntries) ? remoteEntries : [];
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

const report = {
  mode: apply ? "apply" : "dry_run",
  conversationId: leaf.conversation_id,
  title: leaf.title,
  conversationUpdatedAt: leaf.updated_at,
  sourceProviderSessionId: leaf.provider_session_id,
  providerCheckpointId: leaf.provider_checkpoint_id,
  effectiveWorkingDirectory: leaf.effective_working_directory,
  sourceStorage,
  sourceEntries: sourceEntries.length,
  canonicalPrefixEntries: verified.prefix.length,
  canonicalAncestryEntries: verified.ancestry.size,
};

if (!apply) {
  process.stdout.write(
    JSON.stringify(
      {
        ...report,
        validation: {
          currentCheckpointPresent: "passed",
          sourceSessionUntouched: "not_mutated",
        },
        nextCommand:
          "pnpm runtime:native-live-handoff-current-session-local -- --apply"
          + " --expect-conversation " + leaf.conversation_id
          + " --expect-checkpoint " + leaf.provider_checkpoint_id,
      },
      null,
      2,
    ) + "\n",
  );
  process.exit(0);
}


if (sourceStorage !== "local_sdk") {
  throw new Error(
    "The canonical checkpoint exists only in the remote SessionStore. Restore it locally before creating an official Claude Code fork.",
  );
}

const sourceBeforeHash = transcriptHash(localEntries);
const fork = await sdk.forkSession(
  leaf.provider_session_id,
  {
    dir: leaf.effective_working_directory,
    upToMessageId: leaf.provider_checkpoint_id,
  },
);
const forkSessionId = fork.sessionId?.trim();
if (
  !forkSessionId
  || forkSessionId === leaf.provider_session_id
) {
  throw new Error(
    "Claude Agent SDK did not create an isolated fork session.",
  );
}

const [sourceAfter, forkEntries, visible] = await Promise.all([
  importLocalEntries(
    sdk,
    leaf.provider_session_id,
    leaf.effective_working_directory,
  ),
  importLocalEntries(
    sdk,
    forkSessionId,
    leaf.effective_working_directory,
  ),
  sdk.getSessionMessages(
    forkSessionId,
    {
      dir: leaf.effective_working_directory,
      limit: 1,
    },
  ),
]);

if (transcriptHash(sourceAfter) !== sourceBeforeHash) {
  throw new Error(
    "Source Claude session changed while creating the handoff fork.",
  );
}
if (
  forkEntries.length === 0
  || !Array.isArray(visible)
  || visible.length === 0
) {
  throw new Error(
    "Claude Agent SDK cannot read the forked handoff session.",
  );
}

process.stdout.write(
  JSON.stringify(
    {
      ...report,
      handoffSessionId: forkSessionId,
      validation: {
        sourceSessionUnchanged: "passed",
        forkTranscriptReadable: "passed",
        sdkGetSessionMessages: "passed",
      },
      resumeCommand:
        "cd " + shellQuote(leaf.effective_working_directory)
        + " && claude --resume " + shellQuote(forkSessionId),
    },
    null,
    2,
  ) + "\n",
);

async function readCurrentLeaf(
  url: string,
  currentUserId: string,
): Promise<Leaf> {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 5,
    idle_timeout: 5,
  });
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
      WHERE c.user_id = ${currentUserId}::uuid
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
    return current;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function loadInstalledSdk(): Promise<ClaudeSdk> {
  const bridgeRequire = createRequire(
    new URL("../tools/claude-bridge/package.json", import.meta.url),
  );
  const sdkEntry =
    bridgeRequire.resolve("@anthropic-ai/claude-agent-sdk");
  const sdk = await import(pathToFileURL(sdkEntry).href);
  if (
    typeof sdk.forkSession !== "function"
    || typeof sdk.getSessionMessages !== "function"
    || typeof sdk.importSessionToStore !== "function"
  ) {
    throw new Error(
      "Installed Claude Agent SDK does not expose fork/session import helpers.",
    );
  }
  return sdk as ClaudeSdk;
}

async function importLocalEntries(
  sdk: ClaudeSdk,
  sessionId: string,
  workingDirectory: string,
): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  try {
    await sdk.importSessionToStore(
      sessionId,
      {
        async append(key, batch) {
          if (!key.subpath) entries.push(...batch);
        },
        async load() {
          return null;
        },
      },
      {
        dir: workingDirectory,
        includeSubagents: false,
        batchSize: 500,
      },
    );
  } catch {
    return [];
  }
  return entries;
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

function transcriptHash(entries: SessionEntry[]): string {
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
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

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
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

function loadRailwayVariables(
  service: string,
): Record<string, string> {
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
    for (const item of value) {
      collectVariables(item, result);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const [key, candidate] of Object.entries(record)) {
    if (
      typeof candidate === "string"
      && candidate.trim()
      && /^[A-Z][A-Z0-9_]+$/u.test(key)
    ) {
      result[key] = candidate.trim();
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
