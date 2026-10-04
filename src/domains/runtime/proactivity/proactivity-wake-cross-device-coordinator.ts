import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelQueueService,
} from "../../bridge/background/native-live-background-model-queue.js";
import {
  parseClaudeCodeProactivityWakeOutput,
} from "./claude-code-proactivity-wake-model.js";
import {
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
  type ProactivityWakeContextSnapshot,
  type ProactivityWakeGateRevalidator,
  type ProactivityWakePort,
  type ProactivityWakeRecord,
} from "./proactivity-wake-state.js";

type Queue = Pick<
  NativeLiveBackgroundModelQueueService,
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

  async start(_input: {
    gate: ProactivityWakeGateInput;
    contactTarget: string | null;
    context: ProactivityWakeContextSnapshot;
  }): Promise<ProactivityWakeCrossDeviceResult> {
    throw new Error(
      "Legacy Proactivity v1 model staging is retired.",
    );
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
