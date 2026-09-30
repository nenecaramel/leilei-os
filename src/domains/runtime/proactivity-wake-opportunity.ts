import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { CURRENT_SUBJECT_STATE_KINDS } from "./subject-state-contract.js";
import type { createDatabase } from "../../database/client.js";
import type {
  ProactivityWakeOpportunityConfig,
} from "../../config/env.js";
import {
  evaluateProactivityWakeGateAt,
  type ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";
import type {
  EffectStatus,
} from "./effect-protocol.js";
import type {
  ProactivityWakeGateRevalidator,
  ProactivityWakeRecord,
} from "./proactivity-wake-state.js";
import type {
  BackgroundLoopOrchestrator,
} from "./background-loop-orchestrator.js";
import type {
  BackgroundOpportunityTargetPlan,
} from "./background-opportunity-policy.js";
import type {
  ProactivityWakeCrossDeviceCoordinator,
} from "./proactivity-wake-cross-device-coordinator.js";

type Database = ReturnType<typeof createDatabase>["db"];

type LatestConversationRow = {
  id: string;
  current_head_message_id: string;
  latest_user_activity_at: Date;
};

type LatestWakeRow = {
  decided_at: Date;
};

type ForegroundRow = {
  active: boolean;
};

type OutstandingEffectRow = {
  status: string;
};

type SurfaceRow = {
  id: string;
  role: string;
  display_text: string;
  depth: number;
};

type StateRow = {
  id: string;
  kind: string;
  text: string;
};

export type ProactivityWakeOpportunityInput = {
  gate: ProactivityWakeGateInput;
  contactTarget: string;
  context: {
    version: 1;
    contextManifestId: null;
    capsule: string;
    sourceConversationId: string;
    sourceHeadMessageId: string;
    sourceActivityAt: string;
  };
};

export interface ProactivityWakeOpportunitySource
extends ProactivityWakeGateRevalidator {
  buildOpportunity(input: {
    userId: string;
    subjectId: string;
    offeredAt: string;
  }): Promise<ProactivityWakeOpportunityInput | null>;
}

export class DrizzleProactivityWakeOpportunitySource
implements ProactivityWakeOpportunitySource {
  constructor(
    private readonly db: Database,
    private readonly config: ProactivityWakeOpportunityConfig,
  ) {}

  async buildOpportunity(input: {
    userId: string;
    subjectId: string;
    offeredAt: string;
  }): Promise<ProactivityWakeOpportunityInput | null> {
    const snapshot = await this.readSnapshot({
      userId: input.userId,
      subjectId: input.subjectId,
    });
    if (!snapshot) return null;

    const gate = this.gateFromSnapshot({
      wakeId: proactivityWakeId({
        userId: input.userId,
        subjectId: input.subjectId,
        conversationId: snapshot.conversationId,
        headMessageId: snapshot.headMessageId,
        latestUserActivityAt: snapshot.latestUserActivityAt,
        latestDecidedWakeAt: snapshot.latestDecidedWakeAt,
      }),
      userId: input.userId,
      subjectId: input.subjectId,
      offeredAt: input.offeredAt,
      snapshot,
    });
    if (
      evaluateProactivityWakeGateAt(
        gate,
        input.offeredAt,
      ).outcome !== "eligible"
    ) {
      return null;
    }

    const openWake = await this.db.execute<{ id: string }>(sql`
      SELECT id
      FROM runtime_proactivity_wakes
      WHERE user_id = ${input.userId}::uuid
        AND subject_id = ${input.subjectId}
        AND status IN ('created', 'waiting_model')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `);
    if (openWake.length > 0) return null;

    return {
      gate,
      contactTarget: "conversation:" + snapshot.conversationId,
      context: {
        version: 1,
        contextManifestId: null,
        capsule: await this.buildCapsule({
          userId: input.userId,
          subjectId: input.subjectId,
          conversationId: snapshot.conversationId,
          headMessageId: snapshot.headMessageId,
        }),
        sourceConversationId: snapshot.conversationId,
        sourceHeadMessageId: snapshot.headMessageId,
        sourceActivityAt: snapshot.latestUserActivityAt,
      },
    };
  }

  async revalidate(input: {
    wake: ProactivityWakeRecord;
    evaluatedAt: string;
  }) {
    const snapshot = await this.readSnapshot({
      userId: input.wake.userId,
      subjectId: input.wake.subjectId,
    });
    if (!snapshot) {
      return {
        gate: {
          ...input.wake.gate,
          foregroundActive: false,
        },
        activityChanged: true,
      };
    }

    const gate = this.gateFromSnapshot({
      wakeId: input.wake.id,
      userId: input.wake.userId,
      subjectId: input.wake.subjectId,
      offeredAt: input.wake.gate.offeredAt,
      snapshot,
    });
    const expectedTarget =
      "conversation:" + snapshot.conversationId;
    const context = input.wake.context;
    const activityChanged =
      input.wake.contactTarget !== expectedTarget
      || context.sourceConversationId !== snapshot.conversationId
      || context.sourceHeadMessageId !== snapshot.headMessageId
      || context.sourceActivityAt !== snapshot.latestUserActivityAt;

    return {
      gate,
      activityChanged,
    };
  }

  private async readSnapshot(input: {
    userId: string;
    subjectId: string;
  }): Promise<{
    conversationId: string;
    headMessageId: string;
    latestUserActivityAt: string;
    latestDecidedWakeAt: string | null;
    foregroundActive: boolean;
    outstandingEffectStatus: EffectStatus | null;
  } | null> {
    const conversation = await this.db.execute<LatestConversationRow>(sql`
      SELECT
        c.id,
        c.current_head_message_id,
        activity.created_at AS latest_user_activity_at
      FROM conversations AS c
      JOIN LATERAL (
        WITH RECURSIVE current_path AS (
          SELECT
            m.id,
            m.parent_message_id,
            m.role,
            m.status,
            m.created_at,
            0 AS depth
          FROM conversation_messages AS m
          WHERE m.id = c.current_head_message_id
            AND m.user_id = c.user_id
            AND m.conversation_id = c.id

          UNION ALL

          SELECT
            parent.id,
            parent.parent_message_id,
            parent.role,
            parent.status,
            parent.created_at,
            path.depth + 1
          FROM conversation_messages AS parent
          JOIN current_path AS path
            ON parent.id = path.parent_message_id
          WHERE parent.user_id = c.user_id
            AND parent.conversation_id = c.id
        )
        SELECT created_at
        FROM current_path
        WHERE role = 'user'
          AND status = 'completed'
        ORDER BY depth ASC
        LIMIT 1
      ) AS activity ON true
      WHERE c.user_id = ${input.userId}::uuid
        AND c.origin = 'native_live'
        AND c.lifecycle_status = 'active'
        AND c.current_head_message_id IS NOT NULL
      ORDER BY activity.created_at DESC, c.id DESC
      LIMIT 1
    `);
    const current = conversation[0];
    if (!current) return null;

    const [wake, foreground, outstandingEffect] =
      await Promise.all([
      this.db.execute<LatestWakeRow>(sql`
        SELECT decided_at
        FROM runtime_proactivity_wakes
        WHERE user_id = ${input.userId}::uuid
          AND subject_id = ${input.subjectId}
          AND status = 'decided'
          AND decided_at IS NOT NULL
        ORDER BY decided_at DESC, id DESC
        LIMIT 1
      `),
      this.db.execute<ForegroundRow>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM native_live_turn_preparations
          WHERE user_id = ${input.userId}::uuid
            AND dispatch_status IN (
              'staged',
              'pending',
              'reserved',
              'executing',
              'delivery_unknown'
            )
        ) AS active
      `),
      this.db.execute<OutstandingEffectRow>(sql`
        SELECT status
        FROM runtime_effects
        WHERE user_id = ${input.userId}::uuid
          AND subject_id = ${input.subjectId}
          AND (
            status IN (
              'pending',
              'reserved',
              'dispatching',
              'unknown'
            )
            OR (status = 'failed' AND retryable = true)
          )
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `),
    ]);

    return {
      conversationId: current.id,
      headMessageId: current.current_head_message_id,
      latestUserActivityAt:
        current.latest_user_activity_at.toISOString(),
      latestDecidedWakeAt:
        wake[0]?.decided_at?.toISOString() ?? null,
      foregroundActive: foreground[0]?.active ?? false,
      outstandingEffectStatus:
        outstandingEffect[0]
          ? parseEffectStatus(outstandingEffect[0].status)
          : null,
    };
  }

  private gateFromSnapshot(input: {
    wakeId: string;
    userId: string;
    subjectId: string;
    offeredAt: string;
    snapshot: {
      latestUserActivityAt: string;
      latestDecidedWakeAt: string | null;
      foregroundActive: boolean;
      outstandingEffectStatus: EffectStatus | null;
    };
  }): ProactivityWakeGateInput {
    return {
      wakeId: input.wakeId,
      userId: input.userId,
      subjectId: input.subjectId,
      offeredAt: iso(input.offeredAt),
      mode: "live",
      enabled: true,
      foregroundActive: input.snapshot.foregroundActive,
      outstandingEffectStatus:
        input.snapshot.outstandingEffectStatus,
      quietUntil: addMs(
        input.snapshot.latestUserActivityAt,
        this.config.minIdleMs,
      ),
      nextEligibleAt:
        input.snapshot.latestDecidedWakeAt === null
          ? null
          : addMs(
              input.snapshot.latestDecidedWakeAt,
              this.config.cooldownMs,
            ),
    };
  }

  private async buildCapsule(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    headMessageId: string;
  }): Promise<string> {
    const [surfaceRows, stateRows] = await Promise.all([
      this.db.execute<SurfaceRow>(sql`
        WITH RECURSIVE current_path AS (
          SELECT
            m.id,
            m.parent_message_id,
            m.role,
            m.status,
            0 AS depth
          FROM conversation_messages AS m
          WHERE m.id = ${input.headMessageId}::uuid
            AND m.user_id = ${input.userId}::uuid
            AND m.conversation_id = ${input.conversationId}::uuid

          UNION ALL

          SELECT
            parent.id,
            parent.parent_message_id,
            parent.role,
            parent.status,
            path.depth + 1
          FROM conversation_messages AS parent
          JOIN current_path AS path
            ON parent.id = path.parent_message_id
          WHERE parent.user_id = ${input.userId}::uuid
            AND parent.conversation_id = ${input.conversationId}::uuid
        )
        SELECT
          path.id,
          path.role,
          COALESCE(
            string_agg(
              block.text,
              E'\\n'
              ORDER BY block.ordinal
            ) FILTER (
              WHERE block.kind = 'text'
                AND block.text IS NOT NULL
                AND char_length(btrim(block.text)) > 0
            ),
            ''
          ) AS display_text,
          path.depth
        FROM current_path AS path
        LEFT JOIN conversation_content_blocks AS block
          ON block.message_id = path.id
         AND block.user_id = ${input.userId}::uuid
        WHERE path.status = 'completed'
          AND path.role IN ('user', 'assistant')
        GROUP BY path.id, path.role, path.depth
        HAVING count(*) FILTER (
          WHERE block.kind = 'text'
            AND block.text IS NOT NULL
            AND char_length(btrim(block.text)) > 0
        ) > 0
        ORDER BY path.depth ASC
        LIMIT 6
      `),
      this.db.execute<StateRow>(sql`
        SELECT id, kind, text
        FROM runtime_subject_states
        WHERE user_id = ${input.userId}::uuid
          AND subject_id = ${input.subjectId}
          AND validity_status = 'valid'
          AND settlement_status = 'settled'
          AND path_status = 'current'
          AND ${inArray(sql`kind`, CURRENT_SUBJECT_STATE_KINDS)}
          AND NOT (
            kind IN ('memory', 'feel')
            AND payload #>> '{lifecycle_v1,status}'
              IN ('archived', 'forgotten')
          )
          AND text IS NOT NULL
          AND char_length(btrim(text)) > 0
          AND (
            scope_applicability = 'global'
            OR scope_conversation_id = ${input.conversationId}::uuid
          )
          AND (
            scope_path_head_message_id IS NULL
            OR scope_path_head_message_id = ${input.headMessageId}::uuid
          )
          AND envelope #>> '{scope,sensitivity}' = 'normal'
          AND envelope #>> '{scope,visibility}'
            IN ('subject_private', 'user_visible', 'shared')
        ORDER BY updated_at DESC, id DESC
        LIMIT 6
      `),
    ]);

    const capsule = JSON.stringify({
      surface: [...surfaceRows]
        .reverse()
        .map((row) => ({
          message_id: row.id,
          role: row.role,
          text: boundText(row.display_text),
        })),
      subject_state: stateRows.map((row) => ({
        state_id: row.id,
        kind: row.kind,
        text: boundText(row.text),
      })),
    });
    if ([...capsule].length > 8_000) {
      throw new Error(
        "Proactivity wake context capsule exceeded the bounded budget.",
      );
    }
    return capsule;
  }
}

export class ProactivityWakeOpportunityProducer {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule"
    >,
    private readonly source: Pick<
      ProactivityWakeOpportunitySource,
      "buildOpportunity"
    >,
    private readonly coordinator: Pick<
      ProactivityWakeCrossDeviceCoordinator,
      "start"
    >,
    private readonly subjectId: string,
    private readonly plan: BackgroundOpportunityTargetPlan,
    private readonly now: () => string = () =>
      new Date().toISOString(),
  ) {
    if (!subjectId.trim()) {
      throw new Error(
        "Proactivity wake subject id must not be blank.",
      );
    }
    if (plan.kind !== "proactivity_wake") {
      throw new Error(
        "Proactivity wake producer requires a proactivity_wake plan.",
      );
    }
  }

  async scheduleUser(userId: string): Promise<0 | 1> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      throw new Error(
        "Proactivity wake opportunity user id must not be blank.",
      );
    }

    const opportunity =
      await this.source.buildOpportunity({
        userId: normalizedUserId,
        subjectId: this.subjectId,
        offeredAt: this.now(),
      });
    if (!opportunity) return 0;

    this.orchestrator.schedule({
      key: "proactivity-wake:" + opportunity.gate.wakeId,
      kind: "proactivity_wake",
      priority: this.plan.priority,
      cost: this.plan.cost,
      mutexKeys: [
        "proactivity:" + normalizedUserId + ":\u0000:" + this.subjectId,
      ],
      run: () => this.coordinator.start(opportunity),
    });
    return 1;
  }
}

export function proactivityWakeId(input: {
  userId: string;
  subjectId: string;
  conversationId: string;
  headMessageId: string;
  latestUserActivityAt: string;
  latestDecidedWakeAt: string | null;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        namespace: "leileios:proactivity-wake:v1",
        ...input,
      }),
      "utf8",
    )
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

function addMs(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function iso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Proactivity wake opportunity time must be an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}

function boundText(value: string): string {
  return [...value.normalize("NFC").replace(/\r\n?/g, "\n").trim()]
    .slice(0, 400)
    .join("");
}


function parseEffectStatus(value: string): EffectStatus {
  if (
    value !== "pending"
    && value !== "reserved"
    && value !== "dispatching"
    && value !== "observed"
    && value !== "failed"
    && value !== "unknown"
  ) {
    throw new Error(
      "Outstanding runtime effect status is invalid.",
    );
  }
  return value;
}
