import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  runtimeClaudeAccountUsageSnapshots,
} from "../../database/schema.js";
import type {
  NativeLiveNormalizedEvent,
} from "../conversation/native-live-conversation-orchestrator.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type ClaudeAccountUsageWindow = {
  kind: string;
  utilization: number | null;
  resets_at: string | null;
};

export type ClaudeAccountUsageOverage = {
  status: string | null;
  resets_at: string | null;
  disabled_reason: string | null;
  is_using: boolean | null;
};

export type ClaudeAccountUsageRuntimeSnapshot = {
  kind: "claude_account_usage";
  provider: "claude_code";
  status: string | null;
  active_window: string | null;
  windows: ClaudeAccountUsageWindow[];
  overage: ClaudeAccountUsageOverage | null;
  surpassed_threshold: number | null;
};

export type ClaudeAccountUsageSnapshot = {
  provider: "claude_code";
  windows: ClaudeAccountUsageWindow[];
  overage: ClaudeAccountUsageOverage | null;
  observed_at: string;
};

export interface ClaudeAccountUsageWriter {
  observeRuntimeEvents(input: {
    userId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<void>;
}

export interface ClaudeAccountUsageReader {
  readLatest(userId: string): Promise<ClaudeAccountUsageSnapshot | null>;
}

export class DrizzleClaudeAccountUsageRepository
implements ClaudeAccountUsageWriter, ClaudeAccountUsageReader {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async observeRuntimeEvents(input: {
    userId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<void> {
    let latest:
      | {
          snapshot: ClaudeAccountUsageRuntimeSnapshot;
          providerSessionId: string | null;
        }
      | null = null;

    for (const item of input.events) {
      const snapshot = parseClaudeAccountUsageRuntimeEvent(item.event);
      if (!snapshot) continue;
      latest = {
        snapshot,
        providerSessionId: item.event.provider_session_id ?? null,
      };
    }

    if (!latest) return;

    const observedAt = this.now();
    await this.db
      .insert(runtimeClaudeAccountUsageSnapshots)
      .values({
        userId: input.userId,
        provider: latest.snapshot.provider,
        snapshot: latest.snapshot,
        providerSessionId: latest.providerSessionId,
        observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoUpdate({
        target: [
          runtimeClaudeAccountUsageSnapshots.userId,
          runtimeClaudeAccountUsageSnapshots.provider,
        ],
        set: {
          snapshot: latest.snapshot,
          providerSessionId: latest.providerSessionId,
          observedAt,
          updatedAt: observedAt,
        },
      });
  }

  async readLatest(
    userId: string,
  ): Promise<ClaudeAccountUsageSnapshot | null> {
    const [row] = await this.db
      .select({
        provider: runtimeClaudeAccountUsageSnapshots.provider,
        snapshot: runtimeClaudeAccountUsageSnapshots.snapshot,
        observedAt: runtimeClaudeAccountUsageSnapshots.observedAt,
      })
      .from(runtimeClaudeAccountUsageSnapshots)
      .where(
        and(
          eq(runtimeClaudeAccountUsageSnapshots.userId, userId),
          eq(runtimeClaudeAccountUsageSnapshots.provider, "claude_code"),
        ),
      )
      .limit(1);

    if (!row) return null;
    const snapshot = parseClaudeAccountUsageRuntimeSnapshot(row.snapshot);
    if (!snapshot) {
      throw new Error("Stored Claude account usage snapshot is invalid.");
    }
    return {
      provider: "claude_code",
      windows: snapshot.windows,
      overage: snapshot.overage,
      observed_at: row.observedAt.toISOString(),
    };
  }
}

export function parseClaudeAccountUsageRuntimeEvent(
  event: NativeLiveNormalizedEvent,
): ClaudeAccountUsageRuntimeSnapshot | null {
  if (event.type !== "runtime") return null;
  return parseClaudeAccountUsageRuntimeSnapshot(event.payload);
}

export function parseClaudeAccountUsageRuntimeSnapshot(
  value: unknown,
): ClaudeAccountUsageRuntimeSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "claude_account_usage"
    || value.provider !== "claude_code"
  ) {
    return null;
  }

  const windows = Array.isArray(value.windows)
    ? value.windows
        .slice(0, 32)
        .map(parseWindow)
        .filter((window): window is ClaudeAccountUsageWindow =>
          window !== null)
    : [];

  const overage =
    value.overage === null || value.overage === undefined
      ? null
      : parseOverage(value.overage);

  return {
    kind: "claude_account_usage",
    provider: "claude_code",
    status: nullableString(value.status),
    active_window: nullableString(value.active_window),
    windows,
    overage,
    surpassed_threshold: nullableFiniteNumber(
      value.surpassed_threshold,
    ),
  };
}

function parseWindow(value: unknown): ClaudeAccountUsageWindow | null {
  if (!isRecord(value)) return null;
  const kind = nullableString(value.kind);
  if (!kind) return null;
  return {
    kind,
    utilization: nullableFiniteNumber(value.utilization),
    resets_at: nullableIsoTimestamp(value.resets_at),
  };
}

function parseOverage(value: unknown): ClaudeAccountUsageOverage | null {
  if (!isRecord(value)) return null;
  return {
    status: nullableString(value.status),
    resets_at: nullableIsoTimestamp(value.resets_at),
    disabled_reason: nullableString(value.disabled_reason),
    is_using:
      typeof value.is_using === "boolean"
        ? value.is_using
        : null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 128)
    : null;
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function nullableIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value),
  );
}
