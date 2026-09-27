import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationContentBlocks,
  conversationMessages,
  runtimeDriveSatisfactionEvents,
  runtimeSubjectStates,
  type RuntimeDriveSatisfactionEvidenceKind,
} from "../../database/schema.js";
import {
  canonicalizeDriveNumber,
  clampDrivePressure,
  readDriveEvolution,
  writeDriveEvolution,
  type DriveEvolutionPolicy,
  type DriveEvolutionRuntimePort,
} from "./drive-evolution.js";
import { DriveEvolutionService } from "./drive-evolution.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

export type DriveSatisfactionEvidence =
  | {
      kind: "user_message";
      conversationId: string;
      messageId: string;
    }
  | {
      kind: "assistant_message";
      conversationId: string;
      messageId: string;
    }
  | {
      kind: "tool_result";
      conversationId: string;
      messageId: string;
      blockId: string;
    };

export type DriveSatisfactionResult =
  | {
      outcome: "applied" | "idempotent";
      driveStateId: string;
      pressure: number;
      phase: "active" | "satisfied" | "dormant";
      satisfactionTotal: number;
    }
  | {
      outcome: "rejected";
      code:
        | "DRIVE_NOT_FOUND"
        | "DRIVE_NOT_ELIGIBLE"
        | "DRIVE_NOT_EVOLVED"
        | "EVIDENCE_NOT_FOUND"
        | "EVIDENCE_INVALID"
        | "IDEMPOTENCY_CONFLICT";
    };

export interface DriveSatisfactionRuntimePort {
  applySatisfaction(input: {
    userId: string;
    subjectId: string;
    driveStateId: string;
    amount: number;
    activeThreshold: number;
    idempotencyKey: string;
    evidence: DriveSatisfactionEvidence;
    now: string;
  }): Promise<DriveSatisfactionResult>;
}

export type DriveSatisfactionLevel = "partial" | "full";

export class DriveSatisfactionService {
  private readonly evolution: DriveEvolutionService;

  constructor(
    evolutionPort: DriveEvolutionRuntimePort,
    private readonly satisfactionPort: DriveSatisfactionRuntimePort,
    private readonly policy: DriveEvolutionPolicy,
  ) {
    this.evolution = new DriveEvolutionService(evolutionPort, policy);
  }

  async satisfy(input: {
    userId: string;
    subjectId: string;
    driveStateId: string;
    amount: number;
    idempotencyKey: string;
    evidence: DriveSatisfactionEvidence;
    now: string;
  }): Promise<DriveSatisfactionResult> {
    await this.evolution.runOnce({
      userId: input.userId,
      subjectId: input.subjectId,
      now: input.now,
    });

    const result = await this.satisfactionPort.applySatisfaction({
      ...input,
      activeThreshold: this.policy.activeThreshold,
    });
    if (result.outcome !== "rejected") {
      try {
        await this.evolution.runOnce({
          userId: input.userId,
          subjectId: input.subjectId,
          now: input.now,
          mode: "full",
        });
      } catch {
        // Satisfaction is durable authority. Derived projection is fail-soft
        // and can be recovered by the shared maintenance/repair path.
      }
    }
    return result;
  }

  async satisfySemantic(input: {
    userId: string;
    subjectId: string;
    driveStateId: string;
    level: DriveSatisfactionLevel;
    idempotencyKey: string;
    evidence: DriveSatisfactionEvidence;
    now: string;
  }): Promise<DriveSatisfactionResult> {
    const amount =
      input.level === "full"
        ? 1
        : this.policy.reinforcementBoost;
    if (amount <= 0) {
      throw new Error(
        "Partial Drive satisfaction requires positive reinforcementBoost.",
      );
    }
    return this.satisfy({
      ...input,
      amount,
    });
  }
}

export class DrizzleDriveSatisfactionRuntimePort
implements DriveSatisfactionRuntimePort {
  constructor(private readonly db: Database) {}

  async applySatisfaction(input: {
    userId: string;
    subjectId: string;
    driveStateId: string;
    amount: number;
    activeThreshold: number;
    idempotencyKey: string;
    evidence: DriveSatisfactionEvidence;
    now: string;
  }): Promise<DriveSatisfactionResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1) {
      throw new Error("Drive satisfaction amount must be in (0, 1].");
    }
    if (
      !Number.isFinite(input.activeThreshold)
      || input.activeThreshold < 0
      || input.activeThreshold > 1
    ) {
      throw new Error("Drive active threshold must be between zero and one.");
    }
    const now = normalizeIso(input.now);

    return this.db.transaction(
      async (transaction) => {
        await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${input.userId + ":" + input.idempotencyKey},
              0
            )
          )
        `);

        const replay = await this.findEvent(
          transaction as Transaction,
          input.userId,
          input.idempotencyKey,
        );
        if (replay) {
          if (!matchesReplay(replay, input)) {
            return { outcome: "rejected" as const, code: "IDEMPOTENCY_CONFLICT" as const };
          }
          const current = await this.loadDrive(
            transaction as Transaction,
            input.userId,
            input.subjectId,
            replay.driveStateId,
            false,
          );
          const evolution = current
            ? readDriveEvolution(current.payload)
            : null;
          if (!evolution) {
            return { outcome: "rejected" as const, code: "DRIVE_NOT_EVOLVED" as const };
          }
          return {
            outcome: "idempotent" as const,
            driveStateId: replay.driveStateId,
            pressure: evolution.pressure,
            phase: evolution.phase,
            satisfactionTotal: evolution.satisfactionTotal,
          };
        }

        const activeConversation = await transaction.execute<{ id: string }>(sql`
          SELECT id
          FROM conversations
          WHERE id = ${input.evidence.conversationId}::uuid
            AND user_id = ${input.userId}::uuid
            AND origin = 'native_live'
            AND lifecycle_status = 'active'
          FOR SHARE
        `);
        if (activeConversation.length !== 1) {
          return {
            outcome: "rejected" as const,
            code: "EVIDENCE_INVALID" as const,
          };
        }

        const requested = await this.loadDrive(
          transaction as Transaction,
          input.userId,
          input.subjectId,
          input.driveStateId,
          true,
        );
        if (!requested) {
          return { outcome: "rejected" as const, code: "DRIVE_NOT_FOUND" as const };
        }
        if (!isEligibleDrive(requested)) {
          return { outcome: "rejected" as const, code: "DRIVE_NOT_ELIGIBLE" as const };
        }

        const requestedEvolution = readDriveEvolution(requested.payload);
        if (!requestedEvolution) {
          return { outcome: "rejected" as const, code: "DRIVE_NOT_EVOLVED" as const };
        }
        if (
          requestedEvolution.role !== "anchor"
          || requestedEvolution.anchorStateId !== requested.id
        ) {
          return { outcome: "rejected" as const, code: "DRIVE_NOT_ELIGIBLE" as const };
        }

        const anchor = requested;
        const anchorEvolution = requestedEvolution;

        const evidence = await validateEvidence(
          transaction as Transaction,
          input.userId,
          input.evidence,
        );
        if (evidence === "not_found") {
          return { outcome: "rejected" as const, code: "EVIDENCE_NOT_FOUND" as const };
        }
        if (evidence === "invalid") {
          return { outcome: "rejected" as const, code: "EVIDENCE_INVALID" as const };
        }

        const nextSatisfactionTotal = canonicalizeDriveNumber(
          anchorEvolution.satisfactionTotal + input.amount,
        );
        const nextPressure = clampDrivePressure(
          anchorEvolution.pressure - input.amount,
        );
        const nextPhase =
          nextPressure > input.activeThreshold
            ? "active" as const
            : anchorEvolution.phase === "dormant"
              ? "dormant" as const
              : "satisfied" as const;
        const nextEvolution = {
          ...anchorEvolution,
          pressure: nextPressure,
          phase: nextPhase,
          satisfactionTotal: nextSatisfactionTotal,
          lastEvolvedAt: now,
          lastSatisfiedAt: now,
          dormantAt:
            nextPhase === "dormant"
              ? anchorEvolution.dormantAt
              : null,
        };

        await transaction.insert(runtimeDriveSatisfactionEvents).values({
          userId: input.userId,
          subjectId: input.subjectId,
          driveStateId: anchor.id,
          conversationId: input.evidence.conversationId,
          evidenceMessageId: input.evidence.messageId,
          evidenceBlockId:
            input.evidence.kind === "tool_result"
              ? input.evidence.blockId
              : null,
          evidenceKind: input.evidence.kind,
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          createdAt: new Date(now),
        });

        const updated = await transaction
          .update(runtimeSubjectStates)
          .set({
            payload: writeDriveEvolution(anchor.payload, nextEvolution),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, anchor.id),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(runtimeSubjectStates.kind, "drive"),
              eq(runtimeSubjectStates.settlementStatus, "settled"),
              eq(runtimeSubjectStates.pathStatus, "current"),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (updated.length !== 1) {
          throw new Error("Drive satisfaction lost its state lock.");
        }

        return {
          outcome: "applied" as const,
          driveStateId: anchor.id,
          pressure: nextPressure,
          phase: nextEvolution.phase,
          satisfactionTotal: nextSatisfactionTotal,
        };
      },
    );
  }

  private async findEvent(
    executor: Database | Transaction,
    userId: string,
    idempotencyKey: string,
  ): Promise<{
    driveStateId: string;
    conversationId: string;
    evidenceMessageId: string;
    evidenceBlockId: string | null;
    evidenceKind: RuntimeDriveSatisfactionEvidenceKind;
    amount: number;
  } | null> {
    const [row] = await executor
      .select({
        driveStateId: runtimeDriveSatisfactionEvents.driveStateId,
        conversationId: runtimeDriveSatisfactionEvents.conversationId,
        evidenceMessageId: runtimeDriveSatisfactionEvents.evidenceMessageId,
        evidenceBlockId: runtimeDriveSatisfactionEvents.evidenceBlockId,
        evidenceKind: runtimeDriveSatisfactionEvents.evidenceKind,
        amount: runtimeDriveSatisfactionEvents.amount,
      })
      .from(runtimeDriveSatisfactionEvents)
      .where(
        and(
          eq(runtimeDriveSatisfactionEvents.userId, userId),
          eq(runtimeDriveSatisfactionEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async loadDrive(
    executor: Database | Transaction,
    userId: string,
    subjectId: string,
    stateId: string,
    lock: boolean,
  ): Promise<{
    id: string;
    payload: Record<string, unknown> | null;
    settlementStatus: "unsettled" | "settled" | "rejected";
    pathStatus: "current" | "superseded";
    validityStatus: "valid" | "invalidated" | "tombstoned";
  } | null> {
    const query = executor
      .select({
        id: runtimeSubjectStates.id,
        payload: runtimeSubjectStates.payload,
        settlementStatus: runtimeSubjectStates.settlementStatus,
        pathStatus: runtimeSubjectStates.pathStatus,
        validityStatus: runtimeSubjectStates.validityStatus,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.id, stateId),
          eq(runtimeSubjectStates.userId, userId),
          eq(runtimeSubjectStates.subjectId, subjectId),
          eq(runtimeSubjectStates.kind, "drive"),
        ),
      );
    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    return rows[0] ?? null;
  }
}

async function validateEvidence(
  executor: Database | Transaction,
  userId: string,
  evidence: DriveSatisfactionEvidence,
): Promise<"valid" | "not_found" | "invalid"> {
  const [message] = await executor
    .select({
      id: conversationMessages.id,
      role: conversationMessages.role,
      status: conversationMessages.status,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.id, evidence.messageId),
        eq(conversationMessages.userId, userId),
        eq(conversationMessages.conversationId, evidence.conversationId),
      ),
    )
    .limit(1);

  if (!message) return "not_found";
  if (message.status !== "completed") return "invalid";

  if (
    evidence.kind === "user_message"
    || evidence.kind === "assistant_message"
  ) {
    return message.role === (
      evidence.kind === "user_message" ? "user" : "assistant"
    )
      ? "valid"
      : "invalid";
  }

  const [block] = await executor
    .select({
      id: conversationContentBlocks.id,
      kind: conversationContentBlocks.kind,
    })
    .from(conversationContentBlocks)
    .where(
      and(
        eq(conversationContentBlocks.id, evidence.blockId),
        eq(conversationContentBlocks.userId, userId),
        eq(conversationContentBlocks.messageId, evidence.messageId),
      ),
    )
    .limit(1);

  if (!block) return "not_found";
  return block.kind === "tool_result" ? "valid" : "invalid";
}

function matchesReplay(
  event: {
    driveStateId: string;
    conversationId: string;
    evidenceMessageId: string;
    evidenceBlockId: string | null;
    evidenceKind: RuntimeDriveSatisfactionEvidenceKind;
    amount: number;
  },
  input: {
    driveStateId: string;
    amount: number;
    evidence: DriveSatisfactionEvidence;
  },
): boolean {
  return event.driveStateId === input.driveStateId
    && event.conversationId === input.evidence.conversationId
    && event.evidenceMessageId === input.evidence.messageId
    && event.evidenceKind === input.evidence.kind
    && event.evidenceBlockId === (
      input.evidence.kind === "tool_result" ? input.evidence.blockId : null
    )
    && Math.abs(event.amount - input.amount) < 1e-12;
}

function isEligibleDrive(input: {
  settlementStatus: string;
  pathStatus: string;
  validityStatus: string;
}): boolean {
  return (
    input.settlementStatus === "settled"
    && input.pathStatus === "current"
    && input.validityStatus === "valid"
  );
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Drive satisfaction timestamp must be ISO.");
  }
  return new Date(parsed).toISOString();
}

