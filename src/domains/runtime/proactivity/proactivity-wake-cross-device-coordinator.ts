import { createHash } from "node:crypto";
import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelQueueService,
} from "../../bridge/background/native-live-background-model-queue.js";
import {
  buildClaudeCodeProactivityWakePrompt,
  CLAUDE_CODE_PROACTIVITY_WAKE_PROMPT_CONTRACT_VERSION,
  parseClaudeCodeProactivityWakeOutput,
} from "./claude-code-proactivity-wake-model.js";
import {
  evaluateProactivityWakeGate,
  evaluateProactivityWakeGateAt,
  type ProactivityWakeDecision,
  type ProactivityWakeGateInput,
} from "./proactivity-wake-contract.js";
import {
  ProactivityWakeDecisionBuilder,
} from "./proactivity-wake-decision-builder.js";
import type {
  ProactivityEffectMaterializer,
} from "../effects/proactivity-effect-materializer.js";
import {
  normalizeProactivityWakeContext,
  type ProactivityWakeContextSnapshot,
  type ProactivityWakeGateRevalidator,
  type ProactivityWakePort,
  type ProactivityWakeRecord,
} from "./proactivity-wake-state.js";

type Queue = Pick<
  NativeLiveBackgroundModelQueueService,
  | "stage"
  | "findNextUnconsumedTerminalForWorkflow"
  | "markConsumed"
>;

export type ProactivityWakeCrossDeviceResult =
  | { outcome: "waiting"; wakeId: string; taskId: string }
  | { outcome: "staged"; wakeId: string; taskId: string }
  | {
      outcome: "decided";
      wakeId: string;
      decision: ProactivityWakeDecision;
    }
  | { outcome: "wake_missing"; wakeId: string };

export class ProactivityWakeCrossDeviceCoordinator {
  constructor(
    private readonly queue: Queue,
    private readonly wakes: ProactivityWakePort,
    private readonly revalidator:
      ProactivityWakeGateRevalidator | null = null,
    private readonly decisions =
      new ProactivityWakeDecisionBuilder(),
    private readonly now: () => string = () =>
      new Date().toISOString(),
    private readonly effectMaterializer: Pick<
      ProactivityEffectMaterializer,
      "materialize"
    > | null = null,
    private readonly effectDeliveryScheduler: {
      scheduleUser(userId: string): void;
    } | null = null,
  ) {}

  async start(input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
    context: ProactivityWakeContextSnapshot;
  }): Promise<ProactivityWakeCrossDeviceResult> {
    requireUuid(input.gate.wakeId, "wakeId");
    const durable = await this.wakes.createOrGet({
      gate: input.gate,
      contactTarget: input.contactTarget,
      context: normalizeProactivityWakeContext(input.context),
    });

    if (
      durable.status === "decided"
      && durable.decision
    ) {
      await this.materializeEffect(durable);
      return {
        outcome: "decided",
        wakeId: durable.id,
        decision: durable.decision,
      };
    }
    if (
      durable.status === "waiting_model"
      && durable.modelTaskId
    ) {
      return {
        outcome: "waiting",
        wakeId: durable.id,
        taskId: durable.modelTaskId,
      };
    }

    const gate = evaluateProactivityWakeGate(durable.gate);
    if (gate.outcome === "blocked") {
      const completed = await this.wakes.completeDecision({
        userId: durable.userId,
        wakeId: durable.id,
        decision: this.decisions.blocked(
          durable.gate,
          gate.reason,
        ),
      });
      return decidedResult(completed);
    }

    const taskId = modelTaskId(durable.id);
    await this.queue.stage({
      userId: durable.userId,
      subjectId: durable.subjectId,
      command: {
        protocol_version: 1,
        task_id: taskId,
        task_kind: "proactivity_deliberate",
        prompt_contract_version:
          CLAUDE_CODE_PROACTIVITY_WAKE_PROMPT_CONTRACT_VERSION,
        prompt: buildClaudeCodeProactivityWakePrompt({
          gate: durable.gate,
          context: durable.context,
        }),
      },
      workflow: {
        kind: "proactivity_wake",
        runId: durable.id,
        payload: {
          version: 1,
          wake_id: durable.id,
        },
      },
    });

    const waiting = await this.wakes.markWaitingModel({
      userId: durable.userId,
      wakeId: durable.id,
      modelTaskId: taskId,
    });
    if (
      waiting.status === "decided"
      && waiting.decision
    ) {
      await this.materializeEffect(waiting);
      return decidedResult(waiting);
    }
    return {
      outcome: "staged",
      wakeId: durable.id,
      taskId,
    };
  }

  async advanceNextForUser(input: {
    userId: string;
  }): Promise<ProactivityWakeCrossDeviceResult | { outcome: "idle" }> {
    const job =
      await this.queue.findNextUnconsumedTerminalForWorkflow({
        userId: input.userId,
        workflowKind: "proactivity_wake",
      });
    if (!job?.workflow) return { outcome: "idle" };

    let wakeId: string;
    try {
      wakeId = readWakeId(job);
    } catch {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "wake_missing",
        wakeId: job.workflow.runId,
      };
    }

    const durable = await this.wakes.get({
      userId: input.userId,
      wakeId,
    });

    if (!durable) {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return { outcome: "wake_missing", wakeId };
    }

    if (
      durable.status === "decided"
      && durable.decision
    ) {
      await this.materializeEffect(durable);
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return decidedResult(durable);
    }

    if (this.revalidator) {
      const evaluatedAt = this.now();
      const revalidated = await this.revalidator.revalidate({
        wake: durable,
        evaluatedAt,
      });
      const gate = revalidated.activityChanged
        ? {
            outcome: "blocked" as const,
            reason: "activity_changed" as const,
            blockedUntil: null,
          }
        : evaluateProactivityWakeGateAt(
            revalidated.gate,
            evaluatedAt,
          );
      if (gate.outcome === "blocked") {
        const completed = await this.wakes.completeDecision({
          userId: durable.userId,
          wakeId: durable.id,
          decision: this.decisions.blocked(
            durable.gate,
            gate.reason,
          ),
        });
        await this.queue.markConsumed({
          userId: input.userId,
          taskId: job.id,
        });
        return decidedResult(completed);
      }
    }

    let decision: ProactivityWakeDecision;
    if (
      job.status === "failed"
      || job.command.task_kind !== "proactivity_deliberate"
    ) {
      decision = this.decisions.failure(
        durable.gate,
        "deliberation_failed",
      );
    } else {
      try {
        decision = this.decisions.fromDraft({
          gate: durable.gate,
          contactTarget: durable.contactTarget,
          draft: parseClaudeCodeProactivityWakeOutput(
            requireResultText(job),
          ),
        });
      } catch {
        decision = this.decisions.failure(
          durable.gate,
          "invalid_deliberation_output",
        );
      }
    }

    const completed = await this.wakes.completeDecision({
      userId: durable.userId,
      wakeId: durable.id,
      decision,
    });

    await this.materializeEffect(completed);
    await this.queue.markConsumed({
      userId: input.userId,
      taskId: job.id,
    });
    return decidedResult(completed);
  }

  private async materializeEffect(
    wake: ProactivityWakeRecord,
  ): Promise<void> {
    if (!this.effectMaterializer) return;
    const effect =
      await this.effectMaterializer.materialize(wake);
    if (
      effect
      && this.effectDeliveryScheduler
      && (
        effect.status === "pending"
        || effect.status === "reserved"
        || effect.status === "dispatching"
        || effect.status === "unknown"
      )
    ) {
      this.effectDeliveryScheduler.scheduleUser(wake.userId);
    }
  }
}

function decidedResult(
  wake: ProactivityWakeRecord,
): ProactivityWakeCrossDeviceResult {
  if (!wake.decision) {
    throw new Error(
      "Decided proactivity wake is missing its decision.",
    );
  }
  return {
    outcome: "decided",
    wakeId: wake.id,
    decision: wake.decision,
  };
}

function readWakeId(
  job: NativeLiveBackgroundModelJob,
): string {
  if (
    job.workflow?.kind !== "proactivity_wake"
    || job.workflow.payload.version !== 1
    || job.workflow.payload.wake_id !== job.workflow.runId
  ) {
    throw new Error(
      "Proactivity wake workflow payload is invalid.",
    );
  }
  requireUuid(job.workflow.runId, "workflow_run_id");
  return job.workflow.runId;
}

function requireResultText(
  job: NativeLiveBackgroundModelJob,
): string {
  if (!job.resultText?.trim()) {
    throw new Error(
      "Proactivity wake model result text is missing.",
    );
  }
  return job.resultText;
}

function modelTaskId(wakeId: string): string {
  const digest = createHash("sha256")
    .update(
      "leileios:proactivity-wake-deliberation:v1:" + wakeId,
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

function requireUuid(value: string, field: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value)
  ) {
    throw new Error(
      "Proactivity wake " + field + " must be a UUID.",
    );
  }
}
