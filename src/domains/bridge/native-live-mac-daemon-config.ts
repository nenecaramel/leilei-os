import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { isAbsolute } from "node:path";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type NativeLiveMacFilesystem = {
  realpath(path: string): string;
  isDirectory(path: string): boolean;
};

const nativeFilesystem: NativeLiveMacFilesystem = {
  realpath: (path) => realpathSync(path),
  isDirectory: (path) => statSync(path).isDirectory(),
};

export type NativeLiveMacDaemonConfig = {
  relayBaseUrl: string;
  relayToken: string;
  listenerInstanceId: string;
  companionBackgroundIntervalMs: number;
  baseWorkspaceRoot: string;
  workspaceRoots: Readonly<Record<string, string>>;
};

export function resolveNativeLiveMacDaemonConfig(
  environment: NodeJS.ProcessEnv,
  machine: {
    hostname: () => string;
    homedir: () => string;
  } = { hostname, homedir },
  railwayVariablesLoader: () => Record<string, string> =
    loadRailwayProductionVariables,
  filesystem: NativeLiveMacFilesystem = nativeFilesystem,
): NativeLiveMacDaemonConfig {
  let railwayVariables: Record<string, string> | null = null;
  const readRailwayVariables = () => {
    railwayVariables ??= railwayVariablesLoader();
    return railwayVariables;
  };

  const relayBaseUrl =
    firstNonBlank(
      environment.LEILEI_NATIVE_LIVE_RELAY_URL,
      environment.MCP_SERVER_URL,
    )
    ?? firstNonBlank(readRailwayVariables().MCP_SERVER_URL)
    ?? "https://leilei-os-production.up.railway.app";

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(relayBaseUrl);
  } catch {
    throw new Error("Native Live relay URL must be a valid absolute URL.");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("Native Live relay URL must use http or https.");
  }

  const relayToken =
    firstNonBlank(
      environment.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
    )
    ?? firstNonBlank(
      readRailwayVariables().NATIVE_LIVE_RELAY_AUTH_TOKEN,
    );
  if (!relayToken) {
    throw new Error(
      "Native Live relay token is required. Set LEILEI_NATIVE_LIVE_RELAY_TOKEN, or authenticate/link the Railway CLI so NATIVE_LIVE_RELAY_AUTH_TOKEN can be loaded.",
    );
  }

  const configuredListenerId = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_LISTENER_ID,
  );
  const listenerInstanceId = configuredListenerId
    ?? stableListenerInstanceId(machine.hostname(), machine.homedir());

  if (!UUID_PATTERN.test(listenerInstanceId)) {
    throw new Error(
      "LEILEI_NATIVE_LIVE_LISTENER_ID must be a UUID when explicitly configured.",
    );
  }

  const companionBackgroundIntervalSeconds =
    parsePositiveIntegerEnv(
      environment.LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS,
      3_600,
      "LEILEI_NATIVE_LIVE_COMPANION_BACKGROUND_INTERVAL_SECONDS",
    );

  const baseWorkspaceRoot = resolveNativeLiveMacBaseWorkspaceRoot(
    environment,
    machine,
    filesystem,
  );
  const workspaceRoots = resolveNativeLiveMacWorkspaceRoots(
    environment,
    filesystem,
  );

  return {
    relayBaseUrl: relayBaseUrl.replace(/\/+$/u, ""),
    relayToken,
    listenerInstanceId,
    companionBackgroundIntervalMs:
      companionBackgroundIntervalSeconds * 1_000,
    baseWorkspaceRoot,
    workspaceRoots,
  };
}

export function resolveNativeLiveMacWorkspaceRoots(
  environment: NodeJS.ProcessEnv,
  filesystem: NativeLiveMacFilesystem = nativeFilesystem,
): Readonly<Record<string, string>> {
  const raw = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON,
  );
  if (!raw) return Object.freeze({});

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON must be valid JSON.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON must be a JSON object.",
    );
  }

  const result: Record<string, string> = {};
  for (const [workspaceId, value] of Object.entries(parsed)) {
    if (!UUID_PATTERN.test(workspaceId)) {
      throw new Error(
        "LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON keys must be Workspace UUIDs.",
      );
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        "LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON values must be nonblank paths.",
      );
    }
    const candidate = value.trim();
    if (!isAbsolute(candidate)) {
      throw new Error(
        "Workspace roots in LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON must be absolute paths.",
      );
    }

    let canonical: string;
    try {
      canonical = filesystem.realpath(candidate);
    } catch {
      throw new Error(
        "Workspace roots in LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON must resolve to existing directories.",
      );
    }
    let directory = false;
    try {
      directory = filesystem.isDirectory(canonical);
    } catch {
      directory = false;
    }
    if (!directory) {
      throw new Error(
        "Workspace roots in LEILEI_NATIVE_LIVE_WORKSPACE_MAP_JSON must resolve to existing directories.",
      );
    }
    result[workspaceId] = canonical;
  }
  return Object.freeze(result);
}

export function resolveNativeLiveMacBaseWorkspaceRoot(
  environment: NodeJS.ProcessEnv,
  machine: { homedir: () => string } = { homedir },
  filesystem: NativeLiveMacFilesystem = nativeFilesystem,
): string {
  const configured = firstNonBlank(
    environment.LEILEI_NATIVE_LIVE_WORKSPACE_ROOT,
  );
  const candidate = configured ?? machine.homedir();

  if (!isAbsolute(candidate)) {
    throw new Error(
      "LEILEI_NATIVE_LIVE_WORKSPACE_ROOT must be an absolute path.",
    );
  }

  let canonical: string;
  try {
    canonical = filesystem.realpath(candidate);
  } catch {
    throw new Error(
      "Native Live base workspace root must resolve to an existing directory.",
    );
  }

  let directory = false;
  try {
    directory = filesystem.isDirectory(canonical);
  } catch {
    directory = false;
  }
  if (!directory) {
    throw new Error(
      "Native Live base workspace root must resolve to an existing directory.",
    );
  }

  return canonical;
}

export function stableListenerInstanceId(
  host: string,
  home: string,
): string {
  const digest = createHash("sha256")
    .update("leileios:native-live-listener:v1\0")
    .update(host.normalize("NFC"))
    .update("\0")
    .update(home.normalize("NFC"))
    .digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function loadRailwayProductionVariables(): Record<string, string> {
  try {
    const output = execFileSync(
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
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return extractRailwayVariables(JSON.parse(output));
  } catch {
    return {};
  }
}

function extractRailwayVariables(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  collectRailwayVariables(value, result);
  return result;
}

function collectRailwayVariables(
  value: unknown,
  result: Record<string, string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRailwayVariables(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const key of ["MCP_SERVER_URL", "NATIVE_LIVE_RELAY_AUTH_TOKEN"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      result[key] = candidate.trim();
    }
  }

  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.key === "string"
        ? record.key
        : null;
  const variableValue =
    typeof record.value === "string" ? record.value : null;
  if (
    name
    && variableValue
    && (
      name === "MCP_SERVER_URL"
      || name === "NATIVE_LIVE_RELAY_AUTH_TOKEN"
    )
  ) {
    result[name] = variableValue.trim();
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectRailwayVariables(nested, result);
    }
  }
}

function firstNonBlank(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function parsePositiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^[1-9][0-9]*$/u.test(value.trim())) {
    throw new Error(name + " must be a positive integer.");
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(name + " must be a safe positive integer.");
  }
  return parsed;
}
