import {
  and,
  asc,
  eq,
  inArray,
} from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { runtimeSubjectStates } from "../../../database/schema.js";
import {
  forgottenSubjectStatePayload,
  readSubjectStateLifecycle,
  writeSubjectStateLifecycle,
  type MemoryLifecycleForget,
  type MemoryLifecyclePurge,
  type MemoryLifecycleRuntimePort,
  type MemoryLifecycleUpdate,
  type SubjectStateLifecycle,
} from "./memory-lifecycle.js";
import {
  validatePersistentWriteEnvelope,
  type PersistentWriteEnvelope,
} from "../shared/persistent-write-envelope.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleMemoryLifecycleRuntimePort
implements MemoryLifecycleRuntimePort {
  constructor(private readonly db: Database) {}

  async listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }) {
    requirePositiveLimit(input.limit);

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          inArray(runtimeSubjectStates.kind, ["memory"]),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.updatedAt),
        asc(runtimeSubjectStates.id),
      )
      .limit(input.limit);

    return rows.map((row) => {
      if (row.kind !== "memory") {
        throw new Error(
          "Memory lifecycle query returned unsupported state kind.",
        );
      }
      return {
        stateId: row.id,
        kind: row.kind,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async listForgottenCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }) {
    requirePositiveLimit(input.limit);

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          inArray(runtimeSubjectStates.kind, ["memory"]),
          eq(runtimeSubjectStates.validityStatus, "tombstoned"),
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.updatedAt),
        asc(runtimeSubjectStates.id),
      )
      .limit(input.limit);

    return rows.flatMap((row) => {
      if (row.kind !== "memory") return [];
      try {
        if (
          readSubjectStateLifecycle(row.payload)?.status
          !== "forgotten"
        ) {
          return [];
        }
      } catch {
        return [];
      }
      return [{
        stateId: row.id,
        kind: row.kind,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      }];
    });
  }

  async applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly MemoryLifecycleUpdate[];
  }): Promise<{ applied: number; conflicts: number }> {
    if (input.updates.length === 0) {
      return { applied: 0, conflicts: 0 };
    }

    return this.db.transaction(async (transaction) => {
      let applied = 0;
      let conflicts = 0;

      for (const update of input.updates) {
        const rows = await transaction
          .update(runtimeSubjectStates)
          .set({
            payload: update.nextPayload,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, update.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(
                runtimeSubjectStates.updatedAt,
                new Date(update.expectedUpdatedAt),
              ),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (rows.length === 1) applied += 1;
        else conflicts += 1;
      }

      return { applied, conflicts };
    });
  }

  async forgetArchived(input: {
    userId: string;
    subjectId: string;
    forgets: readonly MemoryLifecycleForget[];
  }): Promise<{ applied: number; conflicts: number }> {
    if (input.forgets.length === 0) {
      return { applied: 0, conflicts: 0 };
    }

    return this.db.transaction(async (transaction) => {
      let applied = 0;
      let conflicts = 0;

      for (const forget of input.forgets) {
        const [row] = await transaction
          .select({
            id: runtimeSubjectStates.id,
            kind: runtimeSubjectStates.kind,
            payload: runtimeSubjectStates.payload,
            envelope: runtimeSubjectStates.envelope,
            updatedAt: runtimeSubjectStates.updatedAt,
          })
          .from(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.id, forget.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              inArray(runtimeSubjectStates.kind, ["memory"]),
              eq(runtimeSubjectStates.validityStatus, "valid"),
              eq(
                runtimeSubjectStates.updatedAt,
                new Date(forget.expectedUpdatedAt),
              ),
            ),
          )
          .for("update")
          .limit(1);

        if (!row) {
          conflicts += 1;
          continue;
        }

        let current: SubjectStateLifecycle | null;
        try {
          current = readSubjectStateLifecycle(row.payload);
        } catch {
          current = null;
        }
        if (
          !current
          || current.status !== "archived"
          || current.protected
          || forget.lifecycle.status !== "forgotten"
        ) {
          conflicts += 1;
          continue;
        }

        const currentEnvelope = validatePersistentWriteEnvelope(
          row.envelope as unknown as PersistentWriteEnvelope,
        );
        const nextEnvelope = validatePersistentWriteEnvelope({
          ...currentEnvelope,
          status: {
            ...currentEnvelope.status,
            validityStatus: "tombstoned",
          },
        });

        const rows = await transaction
          .update(runtimeSubjectStates)
          .set({
            text: null,
            payload: forgottenSubjectStatePayload(
              forget.lifecycle,
            ),
            validityStatus: "tombstoned",
            envelope:
              nextEnvelope as unknown as Record<string, unknown>,
            updatedAt: new Date(forget.lifecycle.forgottenAt!),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, forget.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(
                runtimeSubjectStates.updatedAt,
                new Date(forget.expectedUpdatedAt),
              ),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (rows.length === 1) applied += 1;
        else conflicts += 1;
      }

      return { applied, conflicts };
    });
  }

  async purgeForgotten(input: {
    userId: string;
    subjectId: string;
    purges: readonly MemoryLifecyclePurge[];
  }): Promise<{ applied: number; conflicts: number }> {
    if (input.purges.length === 0) {
      return { applied: 0, conflicts: 0 };
    }

    return this.db.transaction(async (transaction) => {
      let applied = 0;
      let conflicts = 0;

      for (const purge of input.purges) {
        const [row] = await transaction
          .select({
            id: runtimeSubjectStates.id,
            payload: runtimeSubjectStates.payload,
          })
          .from(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.id, purge.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              inArray(runtimeSubjectStates.kind, ["memory"]),
              eq(runtimeSubjectStates.validityStatus, "tombstoned"),
              eq(
                runtimeSubjectStates.updatedAt,
                new Date(purge.expectedUpdatedAt),
              ),
            ),
          )
          .for("update")
          .limit(1);

        let lifecycle: SubjectStateLifecycle | null = null;
        if (row) {
          try {
            lifecycle = readSubjectStateLifecycle(row.payload);
          } catch {
            lifecycle = null;
          }
        }
        if (!row || lifecycle?.status !== "forgotten") {
          conflicts += 1;
          continue;
        }

        const rows = await transaction
          .delete(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.id, purge.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(runtimeSubjectStates.validityStatus, "tombstoned"),
              eq(
                runtimeSubjectStates.updatedAt,
                new Date(purge.expectedUpdatedAt),
              ),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (rows.length === 1) applied += 1;
        else conflicts += 1;
      }

      return { applied, conflicts };
    });
  }

  async setProtected(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    protected: boolean;
    at: string;
  }): Promise<boolean> {
    return this.mutateOne(input, (current) => ({
      ...current,
      protected: input.protected,
      lastDecayedAt: input.at,
    }));
  }

  async archive(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    at: string;
  }): Promise<boolean> {
    return this.mutateOne(input, (current) => ({
      ...current,
      status: "archived",
      lastDecayedAt: input.at,
      archivedAt: input.at,
      forgottenAt: null,
    }));
  }

  private async mutateOne(
    input: {
      userId: string;
      subjectId: string;
      stateId: string;
      at: string;
    },
    mutate: (
      current: SubjectStateLifecycle,
    ) => SubjectStateLifecycle,
  ): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          id: runtimeSubjectStates.id,
          kind: runtimeSubjectStates.kind,
          payload: runtimeSubjectStates.payload,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, input.stateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            inArray(runtimeSubjectStates.kind, ["memory"]),
            eq(runtimeSubjectStates.validityStatus, "valid"),
          ),
        )
        .for("update")
        .limit(1);

      if (!row) return false;

      const current =
        readSubjectStateLifecycle(row.payload)
        ?? {
          status: "active" as const,
          salience: 1,
          protected: false,
          lastDecayedAt: input.at,
          lastRecalledAt: null,
          archivedAt: null,
          forgottenAt: null,
        };
      const next = mutate(current);

      const rows = await transaction
        .update(runtimeSubjectStates)
        .set({
          payload: writeSubjectStateLifecycle(row.payload, next),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runtimeSubjectStates.id, input.stateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
          ),
        )
        .returning({ id: runtimeSubjectStates.id });

      return rows.length === 1;
    });
  }
}

function requirePositiveLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      "Memory lifecycle candidate limit must be positive.",
    );
  }
}
