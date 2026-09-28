import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";

const REGISTRY_VERSION = 1;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type NativeLiveMacWorkspaceRegistry =
  Readonly<Record<string, string>>;

export function nativeLiveMacWorkspaceRegistryPath(home: string): string {
  if (!isAbsolute(home)) {
    throw new Error(
      "Native Live Workspace registry home must be an absolute path.",
    );
  }
  return join(
    home,
    ".leileios",
    "native-live-workspaces.json",
  );
}

export function loadNativeLiveMacWorkspaceRegistry(
  registryPath: string,
): NativeLiveMacWorkspaceRegistry {
  requireAbsoluteRegistryPath(registryPath);

  let raw: string;
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") {
      return Object.freeze({});
    }
    throw new Error(
      "Native Live Workspace registry could not be read.",
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "Native Live Workspace registry must contain valid JSON.",
      { cause: error },
    );
  }
  return parseRegistryDocument(parsed);
}

export function writeNativeLiveMacWorkspaceRegistry(
  registryPath: string,
  workspaces: Readonly<Record<string, string>>,
): NativeLiveMacWorkspaceRegistry {
  requireAbsoluteRegistryPath(registryPath);
  const normalized = normalizeWorkspaceEntries(workspaces);
  const ordered = Object.fromEntries(
    Object.entries(normalized).sort(([left], [right]) =>
      left.localeCompare(right)),
  );

  mkdirSync(dirname(registryPath), {
    recursive: true,
    mode: 0o700,
  });

  const temporaryPath =
    registryPath + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(
      temporaryPath,
      JSON.stringify({
        version: REGISTRY_VERSION,
        workspaces: ordered,
      }, null, 2) + "\n",
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    renameSync(temporaryPath, registryPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }

  return Object.freeze({ ...ordered });
}

export function setNativeLiveMacWorkspaceRegistryEntry(
  registryPath: string,
  workspaceId: string,
  workspaceRoot: string,
): NativeLiveMacWorkspaceRegistry {
  validateWorkspaceId(workspaceId);
  const normalizedRoot = validateWorkspaceRoot(workspaceRoot);
  const current = loadNativeLiveMacWorkspaceRegistry(registryPath);
  return writeNativeLiveMacWorkspaceRegistry(registryPath, {
    ...current,
    [workspaceId]: normalizedRoot,
  });
}

export function removeNativeLiveMacWorkspaceRegistryEntry(
  registryPath: string,
  workspaceId: string,
): {
  removed: boolean;
  workspaces: NativeLiveMacWorkspaceRegistry;
} {
  validateWorkspaceId(workspaceId);
  const current = loadNativeLiveMacWorkspaceRegistry(registryPath);
  if (!Object.prototype.hasOwnProperty.call(current, workspaceId)) {
    return {
      removed: false,
      workspaces: current,
    };
  }

  const next = { ...current };
  delete next[workspaceId];
  return {
    removed: true,
    workspaces: writeNativeLiveMacWorkspaceRegistry(
      registryPath,
      next,
    ),
  };
}

function parseRegistryDocument(
  value: unknown,
): NativeLiveMacWorkspaceRegistry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "Native Live Workspace registry must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => key !== "version" && key !== "workspaces")
    || record.version !== REGISTRY_VERSION
  ) {
    throw new Error(
      "Native Live Workspace registry version is unsupported.",
    );
  }
  if (
    !record.workspaces
    || typeof record.workspaces !== "object"
    || Array.isArray(record.workspaces)
  ) {
    throw new Error(
      "Native Live Workspace registry workspaces must be an object.",
    );
  }

  return Object.freeze(
    normalizeWorkspaceEntries(
      record.workspaces as Record<string, unknown>,
    ),
  );
}

function normalizeWorkspaceEntries(
  value: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [workspaceId, workspaceRoot] of Object.entries(value)) {
    validateWorkspaceId(workspaceId);
    result[workspaceId] = validateWorkspaceRoot(workspaceRoot);
  }
  return result;
}

function validateWorkspaceId(workspaceId: string): void {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error(
      "Native Live Workspace registry keys must be Workspace UUIDs.",
    );
  }
}

function validateWorkspaceRoot(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      "Native Live Workspace registry values must be nonblank paths.",
    );
  }
  const root = value.trim();
  if (!isAbsolute(root)) {
    throw new Error(
      "Native Live Workspace registry values must be absolute paths.",
    );
  }
  return root;
}

function requireAbsoluteRegistryPath(registryPath: string): void {
  if (!isAbsolute(registryPath)) {
    throw new Error(
      "Native Live Workspace registry path must be absolute.",
    );
  }
}

function nodeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
