import { getCurrentRequestId } from "./request-context.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type SafeLogScalar = string | number | boolean | null;
export type SafeLogFields = Readonly<Record<string, SafeLogScalar>>;

export type SafeLogger = {
  debug(event: string, fields?: SafeLogFields): void;
  info(event: string, fields?: SafeLogFields): void;
  warn(event: string, fields?: SafeLogFields): void;
  error(event: string, fields?: SafeLogFields): void;
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SAFE_FIELD_NAMES = new Set([
  "method",
  "routeClass",
  "status",
  "durationMs",
  "attempt",
  "maxAttempts",
  "name",
  "code",
  "stage",
  "namespace",
  "reason",
  "activeSessionCount",
  "activeNamespaceCount",
  "deletedRows",
  "batches",
  "capped",
  "policy",
  "diagnosticSessionOrdinal",
  "protocolVersion",
  "clientName",
  "clientVersion",
  "hadUnknownSessionHeader",
  "activeUserNamespaceCount",
  "idleUserNamespaceCount",
  "inFlightUserNamespaceCount",
  "oldestIdleAgeMs",
  "inFlightCountAtClose",
  "idleAgeMsAtClose",
  "signal",
  "surface",
  "authFailure",
  "success",
  "eventId",
  "state",
  "released",
  "outcome",
  "processingState",
  "reconciled",
  "operation",
  "transportStatus",
  "awaitingHostCallback",
  "reconciliation",
  "claimLatencyMs",
  "completionLatencyMs",
  "mindKind",
  "scannedAnchors",
  "terminalAnchors",
  "nonTerminalAnchors",
  "unreadableAnchors",
  "minAgeHours",
  "p50AgeHours",
  "p90AgeHours",
  "maxAgeHours",
  "retentionHours",
  "eligibleThreads",
  "truncated",
]);

const defaultSink = (level: LogLevel, line: string): void => {
  const stream = level === "warn" || level === "error"
    ? process.stderr
    : process.stdout;
  stream.write(`${line}\n`);
};

function isSafeScalar(value: unknown): value is SafeLogScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  return typeof value === "number" && Number.isFinite(value);
}

function projectSafeFields(fields: SafeLogFields | undefined): SafeLogFields {
  const projected: Record<string, SafeLogScalar> = {};
  if (!fields || typeof fields !== "object") return projected;

  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD_NAMES.has(key) || !isSafeScalar(value)) continue;
    projected[key] = value;
  }
  return projected;
}

export function createSafeLogger(options: {
  level: LogLevel;
  sink?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}): SafeLogger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  const log = (level: LogLevel, event: string, fields?: SafeLogFields): void => {
    if (LEVEL_RANK[level] < LEVEL_RANK[options.level]) return;

    try {
      const record: Record<string, SafeLogScalar> = {
        timestamp: now().toISOString(),
        level,
        event,
      };
      const requestId = getCurrentRequestId();
      if (requestId) record.requestId = requestId;
      Object.assign(record, projectSafeFields(fields));
      sink(level, JSON.stringify(record));
    } catch {
      // Logging is observational and must never affect application behavior.
    }
  };

  return {
    debug: (event, fields) => log("debug", event, fields),
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields),
  };
}

export function safeErrorFingerprint(error: unknown): { name: string; code: string } {
  try {
    const nameValue = error instanceof Error ? error.name : undefined;
    const name = typeof nameValue === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(nameValue)
      ? nameValue
      : "UNKNOWN";

    let codeValue: unknown;
    if (typeof error === "object" && error !== null && "code" in error) {
      codeValue = (error as { code?: unknown }).code;
    }
    const normalizedCode = typeof codeValue === "string"
      ? codeValue.toUpperCase()
      : "";
    const code = /^[A-Z0-9_]{1,64}$/.test(normalizedCode)
      ? normalizedCode
      : "UNKNOWN";
    return { name, code };
  } catch {
    return { name: "UNKNOWN", code: "UNKNOWN" };
  }
}
