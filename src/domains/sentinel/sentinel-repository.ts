import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  sentinelWakeRuns,
  sentinels,
} from "../../database/schema.js";
import type {
  SentinelMutationResult,
  SentinelRecord,
  SentinelWakeCause,
  SentinelWakeRunRecord,
} from "./sentinel-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

const sentinelSelection = {
  id: sentinels.id,
  userId: sentinels.userId,
  enabled: sentinels.enabled,
  timezone: sentinels.timezone,
  policyPrompt: sentinels.policyPrompt,
  nextWakeAt: sentinels.nextWakeAt,
  lastValidWakeAt: sentinels.lastValidWakeAt,
  wakeContextCapsule: sentinels.wakeContextCapsule,
  wakeContextUpdatedAt: sentinels.wakeContextUpdatedAt,
  controlRevision: sentinels.controlRevision,
  activeWakeRunId: sentinels.activeWakeRunId,
  createdAt: sentinels.createdAt,
  updatedAt: sentinels.updatedAt,
};

const wakeRunSelection = {
  id: sentinelWakeRuns.id,
  sentinelId: sentinelWakeRuns.sentinelId,
  userId: sentinelWakeRuns.userId,
  controlRevision: sentinelWakeRuns.controlRevision,
  cause: sentinelWakeRuns.cause,
  scheduledFor: sentinelWakeRuns.scheduledFor,
  triggeredAt: sentinelWakeRuns.triggeredAt,
  bridgeEventId: sentinelWakeRuns.bridgeEventId,
  state: sentinelWakeRuns.state,
  decision: sentinelWakeRuns.decision,
  nextWakeAt: sentinelWakeRuns.nextWakeAt,
  claimedAt: sentinelWakeRuns.claimedAt,
  finalizedAt: sentinelWakeRuns.finalizedAt,
  failureCode: sentinelWakeRuns.failureCode,
  createdAt: sentinelWakeRuns.createdAt,
  updatedAt: sentinelWakeRuns.updatedAt,
};

export type SentinelCreateInput = {
  userId: string;
  timezone: string;
  policyPrompt: string;
};

export type SentinelPolicyUpdateInput = {
  userId: string;
  timezone: string;
  policyPrompt: string;
};

export type SentinelWakeRunCreateInput = {
  sentinelId: string;
  userId: string;
  controlRevision: number;
  cause: SentinelWakeCause;
  scheduledFor: Date;
  bridgeEventId: string;
};

export interface SentinelRepository {
  findByUserId(userId: string): Promise<SentinelRecord | null>;
  createSentinel(input: SentinelCreateInput): Promise<SentinelRecord>;
  createForUser?(input: SentinelCreateInput): Promise<SentinelRecord>;
  updatePolicy(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult>;
  updateForUser?(input: SentinelPolicyUpdateInput): Promise<SentinelMutationResult>;
  compareAndAdvanceRevision(input: {
    userId: string;
    expectedRevision: number;
  }): Promise<SentinelMutationResult>;
  createWakeRun(input: SentinelWakeRunCreateInput): Promise<SentinelWakeRunRecord>;
}

export class DrizzleSentinelRepository implements SentinelRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: string): Promise<SentinelRecord | null> {
    const [row] = await this.db
      .select(sentinelSelection)
      .from(sentinels)
      .where(eq(sentinels.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async createSentinel(input: SentinelCreateInput): Promise<SentinelRecord> {
    const [row] = await this.db
      .insert(sentinels)
      .values({
        userId: input.userId,
        timezone: input.timezone,
        policyPrompt: input.policyPrompt,
        enabled: false,
        nextWakeAt: null,
        lastValidWakeAt: null,
        wakeContextCapsule: null,
        wakeContextUpdatedAt: null,
        controlRevision: 0,
        activeWakeRunId: null,
      })
      .returning(sentinelSelection);
    if (!row) throw new Error("Sentinel insert did not return a row.");
    return row;
  }

  async createForUser(input: SentinelCreateInput): Promise<SentinelRecord> {
    return this.createSentinel(input);
  }

  async updatePolicy(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult> {
    const [row] = await this.db
      .update(sentinels)
      .set({
        timezone: input.timezone,
        policyPrompt: input.policyPrompt,
        updatedAt: new Date(),
      })
      .where(eq(sentinels.userId, input.userId))
      .returning(sentinelSelection);
    return row ? { outcome: "applied", sentinel: row } : { outcome: "not_found" };
  }

  async updateForUser(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult> {
    return this.updatePolicy(input);
  }

  async compareAndAdvanceRevision(input: {
    userId: string;
    expectedRevision: number;
  }): Promise<SentinelMutationResult> {
    const current = await this.findByUserId(input.userId);
    if (!current) return { outcome: "not_found" };

    const [row] = await this.db
      .update(sentinels)
      .set({
        controlRevision: sql`${sentinels.controlRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sentinels.userId, input.userId),
          eq(sentinels.controlRevision, input.expectedRevision),
        ),
      )
      .returning(sentinelSelection);
    return row ? { outcome: "applied", sentinel: row } : { outcome: "conflict" };
  }

  async createWakeRun(
    input: SentinelWakeRunCreateInput,
  ): Promise<SentinelWakeRunRecord> {
    const [row] = await this.db
      .insert(sentinelWakeRuns)
      .values({
        sentinelId: input.sentinelId,
        userId: input.userId,
        controlRevision: input.controlRevision,
        cause: input.cause,
        scheduledFor: input.scheduledFor,
        bridgeEventId: input.bridgeEventId,
        state: "bridge_enqueued",
      })
      .returning(wakeRunSelection);
    if (!row) throw new Error("Wake Run insert did not return a row.");
    return row;
  }
}
