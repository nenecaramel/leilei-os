import { createHash, randomUUID } from "node:crypto";
import {
  CLAUDE_CODE_TOPIC_RESURFACE_PROMPT_CONTRACT_VERSION,
  buildClaudeCodeTopicResurfacePrompt,
  parseClaudeCodeTopicResurfaceOutput,
} from "./claude-code-topic-resurface-evaluator.js";
import {
  CLAUDE_CODE_TOPIC_RESURFACE_DELIBERATION_PROMPT_CONTRACT_VERSION,
  buildClaudeCodeTopicResurfaceDeliberationPrompt,
  parseClaudeCodeTopicResurfaceDeliberationOutput,
} from "./claude-code-topic-resurface-deliberator.js";
import {
  CLAUDE_CODE_TOPIC_RESURFACE_RETENTION_PROMPT_CONTRACT_VERSION,
  buildClaudeCodeTopicResurfaceRetentionPrompt,
  parseClaudeCodeTopicResurfaceRetentionOutput,
} from "./claude-code-topic-resurface-retention-evaluator.js";
import type {
  TopicResurfaceCandidate,
  TopicResurfaceCandidateService,
} from "./topic-resurface-candidates.js";
import type {
  TopicResurfaceThoughtMaterializationConfig,
  TopicResurfaceThoughtMaterializationPort,
} from "./topic-resurface-thought-materialization.js";
import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelQueueService,
} from "../bridge/native-live-background-model-queue.js";

type Queue = Pick<
  NativeLiveBackgroundModelQueueService,
  | "stage"
  | "findOpenTopicResurface"
  | "findNextUnconsumedTerminal"
  | "markConsumed"
>;

type CandidateReader = Pick<TopicResurfaceCandidateService, "list">;

export type TopicResurfaceCrossDeviceResult =
  | { outcome: "idle" }
  | { outcome: "waiting"; taskId: string }
  | { outcome: "staged_evaluation"; taskId: string; runId: string }
  | { outcome: "staged_deliberation"; taskId: string; runId: string }
  | { outcome: "staged_retention"; taskId: string; runId: string }
  | { outcome: "quiet"; runId: string }
  | { outcome: "discarded"; runId: string }
  | { outcome: "model_failed"; runId: string }
  | { outcome: "invalid_model_output"; runId: string }
  | { outcome: "materialized"; runId: string; stateId: string }
  | { outcome: "already_materialized"; runId: string; stateId: string }
  | { outcome: "source_ineligible"; runId: string }
  | { outcome: "materialization_failed"; runId: string };

export class TopicResurfaceCrossDeviceCoordinator {
  constructor(
    private readonly queue: Queue,
    private readonly candidates: CandidateReader,
    private readonly materializer: TopicResurfaceThoughtMaterializationPort,
    private readonly config: TopicResurfaceThoughtMaterializationConfig,
  ) {}

  async start(input: {
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }): Promise<TopicResurfaceCrossDeviceResult> {
    const existing = await this.queue.findOpenTopicResurface({
      userId: input.userId,
      subjectId: input.subjectId,
    });
    if (existing) {
      return { outcome: "waiting", taskId: existing.id };
    }

    const evaluatedAt = normalizeIso(input.now);
    const listed = await this.candidates.list({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.candidateLimit,
    });
    if (listed.candidates.length === 0) {
      return { outcome: "idle" };
    }

    const runId = randomUUID();
    const taskId = workflowTaskId(runId, "evaluate");
    await this.queue.stage({
      userId: input.userId,
      subjectId: input.subjectId,
      command: {
        protocol_version: 1,
        task_id: taskId,
        task_kind: "topic_resurface_evaluate",
        prompt_contract_version:
          CLAUDE_CODE_TOPIC_RESURFACE_PROMPT_CONTRACT_VERSION,
        prompt: buildClaudeCodeTopicResurfacePrompt({
          evaluatedAt,
          candidates: listed.candidates,
        }),
      },
      workflow: {
        kind: "topic_resurface",
        runId,
        payload: {
          version: 1,
          stage: "evaluation",
          evaluated_at: evaluatedAt,
          candidate_count: listed.candidates.length,
          candidates: listed.candidates,
        },
      },
    });
    return { outcome: "staged_evaluation", taskId, runId };
  }

  async advanceNextForUser(input: {
    userId: string;
  }): Promise<TopicResurfaceCrossDeviceResult> {
    const job = await this.queue.findNextUnconsumedTerminal(input);
    if (!job?.workflow) return { outcome: "idle" };

    const runId = job.workflow.runId;
    if (job.status === "failed") {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return { outcome: "model_failed", runId };
    }

    if (!job.resultText) {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return { outcome: "invalid_model_output", runId };
    }

    if (job.command.task_kind === "topic_resurface_evaluate") {
      return this.advanceEvaluation(job, input.userId);
    }
    if (job.command.task_kind === "topic_resurface_deliberate") {
      return this.advanceDeliberation(job, input.userId);
    }
    return this.advanceRetention(job, input.userId);
  }

  private async advanceEvaluation(
    job: NativeLiveBackgroundModelJob,
    userId: string,
  ): Promise<TopicResurfaceCrossDeviceResult> {
    const workflow = requireWorkflow(job);
    let payload: ReturnType<typeof readEvaluationPayload>;
    let decision: ReturnType<
      typeof parseClaudeCodeTopicResurfaceOutput
    >;
    try {
      payload = readEvaluationPayload(workflow.payload);
      decision = parseClaudeCodeTopicResurfaceOutput(
        job.resultText!,
        new Set(payload.candidates.map((candidate) => candidate.stateId)),
      );
    } catch {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "invalid_model_output", runId: workflow.runId };
    }
    if (decision.decision === "quiet") {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "quiet", runId: workflow.runId };
    }

    const candidate = payload.candidates.find(
      (item) => item.stateId === decision.stateId,
    );
    if (!candidate) throw new Error("Selected candidate missing.");

    const taskId = workflowTaskId(workflow.runId, "deliberate");
    await this.queue.stage({
      userId,
      subjectId: job.subjectId,
      command: {
        protocol_version: 1,
        task_id: taskId,
        task_kind: "topic_resurface_deliberate",
        prompt_contract_version:
          CLAUDE_CODE_TOPIC_RESURFACE_DELIBERATION_PROMPT_CONTRACT_VERSION,
        prompt: buildClaudeCodeTopicResurfaceDeliberationPrompt({
          evaluatedAt: payload.evaluatedAt,
          candidate,
        }),
      },
      workflow: {
        kind: "topic_resurface",
        runId: workflow.runId,
        payload: {
          version: 1,
          stage: "deliberation",
          evaluated_at: payload.evaluatedAt,
          candidate_count: payload.candidateCount,
          candidate,
        },
      },
    });
    await this.queue.markConsumed({ userId, taskId: job.id });
    return {
      outcome: "staged_deliberation",
      taskId,
      runId: workflow.runId,
    };
  }

  private async advanceDeliberation(
    job: NativeLiveBackgroundModelJob,
    userId: string,
  ): Promise<TopicResurfaceCrossDeviceResult> {
    const workflow = requireWorkflow(job);
    let payload: ReturnType<typeof readDeliberationPayload>;
    let decision: ReturnType<
      typeof parseClaudeCodeTopicResurfaceDeliberationOutput
    >;
    try {
      payload = readDeliberationPayload(workflow.payload);
      decision =
        parseClaudeCodeTopicResurfaceDeliberationOutput(job.resultText!);
    } catch {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "invalid_model_output", runId: workflow.runId };
    }
    if (decision.decision === "quiet") {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "quiet", runId: workflow.runId };
    }

    const taskId = workflowTaskId(workflow.runId, "retention");
    await this.queue.stage({
      userId,
      subjectId: job.subjectId,
      command: {
        protocol_version: 1,
        task_id: taskId,
        task_kind: "topic_resurface_retention",
        prompt_contract_version:
          CLAUDE_CODE_TOPIC_RESURFACE_RETENTION_PROMPT_CONTRACT_VERSION,
        prompt: buildClaudeCodeTopicResurfaceRetentionPrompt({
          evaluatedAt: payload.evaluatedAt,
          candidate: payload.candidate,
          reflection: decision.reflection,
        }),
      },
      workflow: {
        kind: "topic_resurface",
        runId: workflow.runId,
        payload: {
          version: 1,
          stage: "retention",
          evaluated_at: payload.evaluatedAt,
          candidate_count: payload.candidateCount,
          candidate: payload.candidate,
          reflection: decision.reflection,
        },
      },
    });
    await this.queue.markConsumed({ userId, taskId: job.id });
    return {
      outcome: "staged_retention",
      taskId,
      runId: workflow.runId,
    };
  }

  private async advanceRetention(
    job: NativeLiveBackgroundModelJob,
    userId: string,
  ): Promise<TopicResurfaceCrossDeviceResult> {
    const workflow = requireWorkflow(job);
    let payload: ReturnType<typeof readRetentionPayload>;
    let decision: ReturnType<
      typeof parseClaudeCodeTopicResurfaceRetentionOutput
    >;
    try {
      payload = readRetentionPayload(workflow.payload);
      decision =
        parseClaudeCodeTopicResurfaceRetentionOutput(job.resultText!);
    } catch {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "invalid_model_output", runId: workflow.runId };
    }
    if (decision.decision === "discard") {
      await this.queue.markConsumed({ userId, taskId: job.id });
      return { outcome: "discarded", runId: workflow.runId };
    }

    let materialized;
    try {
      materialized = await this.materializer.materialize({
        userId,
        subjectId: job.subjectId,
        sourceTopicStateId: payload.candidate.stateId,
        expectedThreadKey: payload.candidate.threadKey,
        text: payload.reflection,
        evaluatedAt: payload.evaluatedAt,
        config: this.config,
      });
    } catch {
      return {
        outcome: "materialization_failed",
        runId: workflow.runId,
      };
    }

    await this.queue.markConsumed({ userId, taskId: job.id });
    if (materialized.outcome === "source_ineligible") {
      return { outcome: "source_ineligible", runId: workflow.runId };
    }
    return {
      outcome: materialized.outcome,
      runId: workflow.runId,
      stateId: materialized.stateId,
    };
  }
}

function workflowTaskId(
  runId: string,
  stage: "evaluate" | "deliberate" | "retention",
): string {
  const digest = createHash("sha256")
    .update("leileios:topic-resurface-xdevice:v1:" + runId + "\0" + stage)
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

function requireWorkflow(job: NativeLiveBackgroundModelJob) {
  if (!job.workflow || job.workflow.kind !== "topic_resurface") {
    throw new Error("Topic resurface workflow metadata is missing.");
  }
  return job.workflow;
}

function readEvaluationPayload(value: Record<string, unknown>) {
  const common = readCommon(value, "evaluation");
  if (!Array.isArray(value.candidates) || value.candidates.length === 0) {
    throw new Error("Evaluation workflow candidates are invalid.");
  }
  return {
    ...common,
    candidates: value.candidates.map(readCandidate),
  };
}

function readDeliberationPayload(value: Record<string, unknown>) {
  return {
    ...readCommon(value, "deliberation"),
    candidate: readCandidate(value.candidate),
  };
}

function readRetentionPayload(value: Record<string, unknown>) {
  const common = readCommon(value, "retention");
  if (typeof value.reflection !== "string" || !value.reflection.trim()) {
    throw new Error("Retention workflow reflection is invalid.");
  }
  return {
    ...common,
    candidate: readCandidate(value.candidate),
    reflection: value.reflection.normalize("NFC").trim(),
  };
}

function readCommon(
  value: Record<string, unknown>,
  stage: "evaluation" | "deliberation" | "retention",
) {
  if (
    value.version !== 1
    || value.stage !== stage
    || typeof value.evaluated_at !== "string"
    || !Number.isInteger(value.candidate_count)
    || (value.candidate_count as number) < 1
  ) {
    throw new Error("Topic resurface workflow payload is invalid.");
  }
  return {
    evaluatedAt: normalizeIso(value.evaluated_at),
    candidateCount: value.candidate_count as number,
  };
}

function readCandidate(value: unknown): TopicResurfaceCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Topic resurface candidate snapshot is invalid.");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.stateId !== "string"
    || typeof item.text !== "string"
    || typeof item.threadKey !== "string"
    || !Number.isInteger(item.reinforcementCount)
    || typeof item.lastReinforcedAt !== "string"
    || typeof item.dormantAt !== "string"
  ) {
    throw new Error("Topic resurface candidate snapshot is invalid.");
  }
  return {
    stateId: item.stateId,
    text: item.text,
    threadKey: item.threadKey,
    reinforcementCount: item.reinforcementCount as number,
    lastReinforcedAt: normalizeIso(item.lastReinforcedAt),
    dormantAt: normalizeIso(item.dormantAt),
  };
}

function normalizeIso(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Timestamp must be an ISO string.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Timestamp must be an ISO string.");
  }
  return new Date(parsed).toISOString();
}
