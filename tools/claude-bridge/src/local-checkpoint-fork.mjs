import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const RECEIPT_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function configDirectory(environment) {
  const configured =
    typeof environment?.CLAUDE_CONFIG_DIR === "string"
    && environment.CLAUDE_CONFIG_DIR.trim()
      ? environment.CLAUDE_CONFIG_DIR.trim()
      : null;
  return configured
    ? resolve(configured)
    : join(homedir(), ".claude");
}

function projectsDirectory(environment) {
  return join(configDirectory(environment), "projects");
}

function receiptDirectory() {
  return join(
    homedir(),
    ".leileios",
    "local-checkpoint-fork-receipts",
  );
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fsyncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function safeProjectDirectoryName(value) {
  return (
    typeof value === "string"
    && value.length > 0
    && value !== "."
    && value !== ".."
    && basename(value) === value
  );
}

async function findUniqueLocalSessionTranscript({
  sessionId,
  environment,
}) {
  const root = projectsDirectory(environment);
  let directories;
  try {
    directories = await readdir(root, {
      withFileTypes: true,
    });
  } catch (cause) {
    throw runtimeError(
      "Claude local projects directory is unavailable for historical fork.",
      {
        runtimeCode: "NO_PROVIDER_SESSION",
        parentSessionId: sessionId,
        cause,
      },
    );
  }

  const matches = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const candidate = join(
      root,
      directory.name,
      sessionId + ".jsonl",
    );
    if (await exists(candidate)) {
      matches.push({
        projectDirectoryName: directory.name,
        path: candidate,
      });
    }
  }

  if (matches.length !== 1) {
    throw runtimeError(
      "Claude local parent transcript could not be located uniquely in the current config directory.",
      {
        runtimeCode: "NO_PROVIDER_SESSION",
        parentSessionId: sessionId,
        localTranscriptMatches: matches.length,
      },
    );
  }

  return matches[0];
}

async function writeDurableReceipt({
  sessionId,
  projectDirectoryName,
}) {
  const directory = receiptDirectory();
  await mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });
  const path = join(directory, sessionId + ".json");
  const temporary =
    path + "." + process.pid + "." + randomUUID() + ".tmp";
  const payload = JSON.stringify({
    version: RECEIPT_VERSION,
    session_id: sessionId,
    project_directory: projectDirectoryName,
    created_at: new Date().toISOString(),
  });

  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await fsyncDirectory(directory);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw cause;
  }
  return path;
}

async function removeReceipt(path) {
  const directory = dirname(path);
  try {
    await unlink(path);
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
    return;
  }
  await fsyncDirectory(directory);
}

async function cleanupMaterializedFork({
  transcriptPath,
  receiptPath,
}) {
  try {
    await unlink(transcriptPath);
    await fsyncDirectory(dirname(transcriptPath));
  } catch (cause) {
    if (cause?.code !== "ENOENT") throw cause;
  }
  await removeReceipt(receiptPath);
}

function encodePrefix(prefix, syntheticSessionId) {
  return prefix
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return JSON.stringify(entry);
      }
      return JSON.stringify({
        ...entry,
        sessionId: syntheticSessionId,
        ...(Object.hasOwn(entry, "session_id")
          ? { session_id: syntheticSessionId }
          : {}),
      });
    })
    .join("\n") + "\n";
}

export async function prepareLocalCheckpointFork({
  sessionId,
  checkpointId,
  prefix,
  cwd,
  environment = process.env,
}) {
  if (!Array.isArray(prefix) || prefix.length === 0) {
    throw runtimeError(
      "Claude historical checkpoint prefix is unavailable for local fork.",
      {
        runtimeCode: "NO_PROVIDER_SESSION",
        parentSessionId: sessionId,
      },
    );
  }

  // The caller has already verified that the SDK can read sessionId in cwd.
  // Find its physical JSONL by session id instead of reproducing Claude's
  // private cwd-to-project-directory encoding rules.
  const source = await findUniqueLocalSessionTranscript({
    sessionId,
    environment,
  });
  const syntheticSessionId = randomUUID();
  const projectDirectory = dirname(source.path);
  const syntheticPath = join(
    projectDirectory,
    syntheticSessionId + ".jsonl",
  );

  // Commit cleanup intent before creating the transient transcript. A daemon
  // crash can therefore never strand an untracked synthetic session.
  const receiptPath = await writeDurableReceipt({
    sessionId: syntheticSessionId,
    projectDirectoryName: source.projectDirectoryName,
  });

  const encoded = encodePrefix(prefix, syntheticSessionId);
  try {
    let file;
    file = await open(syntheticPath, "wx", 0o600);
    try {
      await file.writeFile(encoded, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await fsyncDirectory(projectDirectory);
  } catch (cause) {
    await unlink(syntheticPath).catch(() => undefined);
    await fsyncDirectory(projectDirectory).catch(() => undefined);
    await removeReceipt(receiptPath).catch(() => undefined);
    throw runtimeError(
      "Failed to materialize local historical checkpoint fork source.",
      {
        runtimeCode: "RUNTIME_UNAVAILABLE",
        parentSessionId: sessionId,
        checkpointId,
        cwd,
        cause,
      },
    );
  }

  return {
    sessionId: syntheticSessionId,
    async cleanup() {
      await cleanupMaterializedFork({
        transcriptPath: syntheticPath,
        receiptPath,
      });
    },
  };
}

function validateReceipt(record, filename, environment) {
  if (
    !record
    || typeof record !== "object"
    || Array.isArray(record)
    || record.version !== RECEIPT_VERSION
    || typeof record.session_id !== "string"
    || !UUID_PATTERN.test(record.session_id)
    || filename !== record.session_id + ".json"
    || !safeProjectDirectoryName(record.project_directory)
  ) {
    throw new Error(
      "Invalid local checkpoint fork receipt.",
    );
  }

  const root = resolve(projectsDirectory(environment));
  const projectDirectory = resolve(
    root,
    record.project_directory,
  );
  if (dirname(projectDirectory) !== root) {
    throw new Error(
      "Local checkpoint fork receipt escapes Claude projects directory.",
    );
  }

  const transcriptPath = join(
    projectDirectory,
    record.session_id + ".jsonl",
  );
  if (
    dirname(transcriptPath) !== projectDirectory
    || basename(transcriptPath)
      !== record.session_id + ".jsonl"
  ) {
    throw new Error(
      "Local checkpoint fork transcript path is invalid.",
    );
  }

  return {
    sessionId: record.session_id,
    projectDirectory,
    transcriptPath,
  };
}

export async function cleanupOrphanedLocalCheckpointForks({
  environment = process.env,
} = {}) {
  const directory = receiptDirectory();
  let names;
  try {
    names = await readdir(directory);
  } catch (cause) {
    if (cause?.code === "ENOENT") {
      return {
        cleaned: 0,
        temporaryReceiptsRemoved: 0,
        failures: [],
      };
    }
    throw cause;
  }

  let cleaned = 0;
  let temporaryReceiptsRemoved = 0;
  const failures = [];

  for (const name of names) {
    if (name.endsWith(".tmp")) {
      try {
        await unlink(join(directory, name));
        temporaryReceiptsRemoved += 1;
      } catch (cause) {
        if (cause?.code !== "ENOENT") {
          failures.push({
            receipt: name,
            error:
              cause instanceof Error
                ? cause.message
                : String(cause),
          });
        }
      }
      continue;
    }
    if (!name.endsWith(".json")) continue;

    const receiptPath = join(directory, name);
    try {
      const handle = await open(receiptPath, "r");
      let raw;
      try {
        raw = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
      const receipt = validateReceipt(
        JSON.parse(raw),
        name,
        environment,
      );

      try {
        await unlink(receipt.transcriptPath);
        await fsyncDirectory(receipt.projectDirectory);
      } catch (cause) {
        if (cause?.code !== "ENOENT") throw cause;
      }
      await removeReceipt(receiptPath);
      cleaned += 1;
    } catch (cause) {
      failures.push({
        receipt: name,
        error:
          cause instanceof Error
            ? cause.message
            : String(cause),
      });
    }
  }

  if (temporaryReceiptsRemoved > 0) {
    await fsyncDirectory(directory).catch(() => undefined);
  }

  return {
    cleaned,
    temporaryReceiptsRemoved,
    failures,
  };
}
