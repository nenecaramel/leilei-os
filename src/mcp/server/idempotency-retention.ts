import { lt } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { mcpWriteIdempotency } from "../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type IdempotencyCleanupObserverEvent =
  | { name: "mcp_idempotency_cleanup_completed"; deletedRows: number; durationMs: number }
  | { name: "mcp_idempotency_cleanup_failed"; durationMs: number };

export async function deleteExpiredMcpIdempotency(
  database: Database,
  cutoff: Date,
): Promise<number> {
  const deleted = await database
    .delete(mcpWriteIdempotency)
    .where(lt(mcpWriteIdempotency.createdAt, cutoff))
    .returning({ id: mcpWriteIdempotency.id });
  return deleted.length;
}

export class McpIdempotencyCleanupCoordinator {
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly intervalMs: number;
  private readonly cleanup: (cutoff: Date) => Promise<number>;
  private readonly observer?: (event: IdempotencyCleanupObserverEvent) => void;
  private lastAttemptAt: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: {
    now?: () => number;
    retentionMs: number;
    intervalMs: number;
    cleanup: (cutoff: Date) => Promise<number>;
    observer?: (event: IdempotencyCleanupObserverEvent) => void;
  }) {
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs;
    this.intervalMs = options.intervalMs;
    this.cleanup = options.cleanup;
    this.observer = options.observer;
  }

  async maybeCleanup(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const startedAt = this.now();
    if (
      this.lastAttemptAt !== null &&
      startedAt - this.lastAttemptAt < this.intervalMs
    ) {
      return;
    }

    this.lastAttemptAt = startedAt;
    const operation = (async () => {
      try {
        const deletedRows = await this.cleanup(
          new Date(startedAt - this.retentionMs),
        );
        this.emit({
          name: "mcp_idempotency_cleanup_completed",
          deletedRows,
          durationMs: Math.max(0, this.now() - startedAt),
        });
      } catch {
        this.emit({
          name: "mcp_idempotency_cleanup_failed",
          durationMs: Math.max(0, this.now() - startedAt),
        });
      } finally {
        this.inFlight = null;
      }
    })();
    this.inFlight = operation;
    return operation;
  }

  private emit(event: IdempotencyCleanupObserverEvent): void {
    try {
      this.observer?.(event);
    } catch {
      // Observability must never affect initialize.
    }
  }
}
