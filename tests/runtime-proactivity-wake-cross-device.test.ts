import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelWorkflow,
} from "../src/domains/bridge/native-live-background-model-queue.js";
import {
  ProactivityWakeCrossDeviceCoordinator,
} from "../src/domains/runtime/proactivity-wake-cross-device-coordinator.js";
import {
  ProactivityWakeDecisionBuilder,
} from "../src/domains/runtime/proactivity-wake-service.js";
import type {
  ProactivityWakePort,
  ProactivityWakeRecord,
} from "../src/domains/runtime/proactivity-wake-state.js";

const userId = "22222222-2222-4222-8222-222222222222";
const wakeId = "11111111-1111-4111-8111-111111111111";
const offeredAt = "2026-09-23T09:30:00.000Z";

function baseGate() {
  return {
    wakeId,
    userId,
    subjectId: "G",
    offeredAt,
    mode: "live" as const,
    enabled: true,
    foregroundActive: false,
    outstandingEffectStatus: null,
    quietUntil: null,
    nextEligibleAt: null,
  };
}

class WakeMemory implements ProactivityWakePort {
  record: ProactivityWakeRecord | null = null;

  async createOrGet(input: Parameters<ProactivityWakePort["createOrGet"]>[0]) {
    if (!this.record) {
      this.record = {
        id: input.gate.wakeId,
        userId: input.gate.userId,
        subjectId: input.gate.subjectId,
        gate: input.gate,
        contactTarget: input.contactTarget,
        context: input.context,
        status: "created",
        modelTaskId: null,
        decision: null,
        createdAt: offeredAt,
        updatedAt: offeredAt,
        decidedAt: null,
      };
    }
    return this.record;
  }

  async get() {
    return this.record;
  }

  async markWaitingModel(input: {
    userId: string;
    wakeId: string;
    modelTaskId: string;
  }) {
    const current = this.record;
    assert.ok(current);
    this.record = {
      ...current,
      status: "waiting_model",
      modelTaskId: input.modelTaskId,
      updatedAt: "2026-09-23T09:30:01.000Z",
    };
    return this.record;
  }

  async completeDecision(
    input: Parameters<ProactivityWakePort["completeDecision"]>[0],
  ) {
    const current = this.record;
    assert.ok(current);
    this.record = {
      ...current,
      status: "decided",
      decision: input.decision,
      decidedAt: input.decision.decidedAt,
      updatedAt: input.decision.decidedAt,
    };
    return this.record;
  }
}

class QueueMemory {
  jobs: NativeLiveBackgroundModelJob[] = [];

  async stage(input: {
    userId: string;
    subjectId: string;
    command: NativeLiveBackgroundModelJob["command"];
    workflow?: NativeLiveBackgroundModelWorkflow;
  }) {
    const existing = this.jobs.find(
      (job) => job.id === input.command.task_id,
    );
    if (existing) return existing;
    const job: NativeLiveBackgroundModelJob = {
      id: input.command.task_id,
      userId: input.userId,
      subjectId: input.subjectId,
      workflow: input.workflow ?? null,
      command: input.command,
      status: "pending",
      reservedBy: null,
      resultText: null,
      errorCode: null,
      consumedAt: null,
    };
    this.jobs.push(job);
    return job;
  }

  async findNextUnconsumedTerminalForWorkflow(input: {
    userId: string;
    workflowKind:
      | "topic_resurface"
      | "distillation"
      | "proactivity_wake";
  }) {
    return this.jobs.find((job) =>
      job.userId === input.userId
      && job.workflow?.kind === input.workflowKind
      && job.consumedAt === null
      && (job.status === "completed" || job.status === "failed")
    ) ?? null;
  }

  async markConsumed(input: {
    userId: string;
    taskId: string;
  }) {
    const job = this.jobs.find((candidate) =>
      candidate.userId === input.userId
      && candidate.id === input.taskId
    );
    if (job) {
      job.consumedAt =
        new Date("2026-09-23T09:31:00.000Z");
    }
  }
}

function coordinator(
  wakes = new WakeMemory(),
  queue = new QueueMemory(),
) {
  return {
    wakes,
    queue,
    coordinator: new ProactivityWakeCrossDeviceCoordinator(
      queue as never,
      wakes,
      new ProactivityWakeDecisionBuilder(
        () => "2026-09-23T09:30:05.000Z",
        () => "decision-1",
      ),
    ),
  };
}

test("blocked durable wake decides quiet without staging Mac model work", async () => {
  const state = coordinator();
  const result = await state.coordinator.start({
    gate: {
      ...baseGate(),
      foregroundActive: true,
    },
    contactTarget: "conversation:c1",
    context: {
      version: 1,
      contextManifestId: null,
      capsule: "",
    },
  });

  assert.equal(result.outcome, "decided");
  if (result.outcome !== "decided") return;
  assert.equal(
    result.decision.reasonCode,
    "gate_foreground_active",
  );
  assert.equal(state.queue.jobs.length, 0);
  assert.equal(state.wakes.record?.status, "decided");
});

test("eligible wake stages one durable pure-model task and repeated start waits on the same task", async () => {
  const state = coordinator();
  const input = {
    gate: baseGate(),
    contactTarget: "conversation:c1",
    context: {
      version: 1 as const,
      contextManifestId: "manifest-1",
      capsule: "A bounded backend-owned context snapshot.",
    },
  };

  const first = await state.coordinator.start(input);
  assert.equal(first.outcome, "staged");
  assert.equal(state.queue.jobs.length, 1);
  assert.equal(
    state.queue.jobs[0]?.command.task_kind,
    "proactivity_deliberate",
  );
  assert.equal(
    state.queue.jobs[0]?.workflow?.kind,
    "proactivity_wake",
  );
  assert.match(
    state.queue.jobs[0]?.command.prompt ?? "",
    /BEGIN_UNTRUSTED_WAKE_CONTEXT_JSON/,
  );

  const second = await state.coordinator.start(input);
  assert.equal(second.outcome, "waiting");
  assert.equal(state.queue.jobs.length, 1);
});

test("Mac result becomes a durable backend-bound contact candidate, never a dispatch", async () => {
  const state = coordinator();
  await state.coordinator.start({
    gate: baseGate(),
    contactTarget: "conversation:c1",
    context: {
      version: 1,
      contextManifestId: null,
      capsule: "Useful context.",
    },
  });

  const job = state.queue.jobs[0]!;
  job.status = "completed";
  job.resultText =
    '{"outcome":"contact_candidate","text":"想起你之前提过的一件事。"}';

  const result =
    await state.coordinator.advanceNextForUser({ userId });
  assert.equal(result.outcome, "decided");
  if (result.outcome !== "decided") return;
  assert.equal(
    result.decision.outcome,
    "contact_candidate",
  );
  assert.equal(
    result.decision.effectIntent?.target,
    "conversation:c1",
  );
  assert.equal(state.wakes.record?.status, "decided");
  assert.ok(job.consumedAt);
});

test("model failure or invalid output fails closed to a durable quiet decision", async () => {
  for (const mode of ["failed", "invalid"] as const) {
    const wakes = new WakeMemory();
    const queue = new QueueMemory();
    const state = coordinator(wakes, queue);
    await state.coordinator.start({
      gate: baseGate(),
      contactTarget: "conversation:c1",
      context: {
        version: 1,
        contextManifestId: null,
        capsule: "",
      },
    });
    const job = queue.jobs[0]!;
    if (mode === "failed") {
      job.status = "failed";
      job.errorCode = "RUNTIME_UNAVAILABLE";
    } else {
      job.status = "completed";
      job.resultText = "not-json";
    }

    const result =
      await state.coordinator.advanceNextForUser({ userId });
    assert.equal(result.outcome, "decided");
    if (result.outcome !== "decided") continue;
    assert.equal(result.decision.outcome, "quiet");
    assert.equal(
      result.decision.reasonCode,
      mode === "failed"
        ? "deliberation_failed"
        : "invalid_deliberation_output",
    );
    assert.ok(job.consumedAt);
  }
});
