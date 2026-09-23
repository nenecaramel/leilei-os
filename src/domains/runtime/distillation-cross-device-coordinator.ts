import { createHash, randomUUID } from "node:crypto";
import type {
  NativeLiveConversation,
} from "../conversation/native-live-conversation-types.js";
import type {
  NativeLiveBackgroundModelJob,
  NativeLiveBackgroundModelQueueService,
} from "../bridge/native-live-background-model-queue.js";
import {
  CLAUDE_CODE_DISTILLATION_PROMPT_CONTRACT_VERSION,
  buildClaudeCodeDistillationPrompt,
  parseClaudeCodeDistillationOutput,
} from "./claude-code-distillation-model.js";
import {
  commitDistillationDrafts,
  planDistillationWindow,
  type DistillationConfig,
  type DistillationRuntimePort,
  type DistillationTranscriptMessage,
  type DistillationWindow,
} from "./distillation.js";

type Queue = Pick<
  NativeLiveBackgroundModelQueueService,
  | "stage"
  | "findOpenDistillation"
  | "findNextUnconsumedTerminalForWorkflow"
  | "markConsumed"
>;

export interface DistillationCrossDeviceConversationReader {
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;
}

export type DistillationCrossDeviceResult =
  | { outcome: "idle" }
  | { outcome: "waiting"; taskId: string }
  | { outcome: "staged"; taskId: string; runId: string }
  | { outcome: "model_failed"; runId: string }
  | { outcome: "invalid_model_output"; runId: string }
  | { outcome: "source_superseded"; runId: string }
  | { outcome: "conflict"; runId: string }
  | {
      outcome: "committed";
      runId: string;
      sourceHeadMessageId: string;
      createdStateIds: string[];
      resetFromSupersededWatermark: boolean;
    };

export class DistillationCrossDeviceCoordinator {
  constructor(
    private readonly queue: Queue,
    private readonly conversations:
      DistillationCrossDeviceConversationReader,
    private readonly port: DistillationRuntimePort,
    private readonly config: DistillationConfig,
  ) {
    if (
      !Number.isInteger(config.maxMemoriesPerRun)
      || config.maxMemoriesPerRun < 1
    ) {
      throw new Error(
        "Distillation maxMemoriesPerRun must be a positive integer.",
      );
    }
  }

  async start(input: {
    userId: string;
    subjectId: string;
    conversationId: string;
  }): Promise<DistillationCrossDeviceResult> {
    const userId = input.userId.trim();
    const subjectId = input.subjectId.trim();
    const conversationId = input.conversationId.trim();
    if (!userId || !subjectId || !conversationId) {
      throw new Error(
        "Distillation cross-device identity must not be blank.",
      );
    }

    const existing = await this.queue.findOpenDistillation({
      userId,
      subjectId,
      conversationId,
    });
    if (existing) {
      return { outcome: "waiting", taskId: existing.id };
    }

    const conversation = await this.conversations.getConversation({
      userId,
      conversationId,
    });
    if (!conversation) return { outcome: "idle" };

    const previousWatermarkMessageId = await this.port.getWatermark({
      userId,
      subjectId,
      conversationId,
    });
    const window = planDistillationWindow({
      conversation,
      surfaceLimit: this.config.surfaceLimit,
      previousWatermarkMessageId,
    });
    if (!window) return { outcome: "idle" };

    const runId = randomUUID();
    const taskId = workflowTaskId(runId);
    await this.queue.stage({
      userId,
      subjectId,
      command: {
        protocol_version: 1,
        task_id: taskId,
        task_kind: "distillation",
        prompt_contract_version:
          CLAUDE_CODE_DISTILLATION_PROMPT_CONTRACT_VERSION,
        prompt: buildClaudeCodeDistillationPrompt({
          conversationId,
          sourceHeadMessageId: window.sourceHeadMessageId,
          transcript: window.transcript,
        }),
      },
      workflow: {
        kind: "distillation",
        runId,
        payload: {
          version: 1,
          conversation_id: conversationId,
          source_head_message_id: window.sourceHeadMessageId,
          expected_previous_watermark_message_id:
            window.expectedPreviousWatermarkMessageId,
          reset_from_superseded_watermark:
            window.resetFromSupersededWatermark,
          transcript: window.transcript,
        },
      },
    });

    return { outcome: "staged", taskId, runId };
  }

  async advanceNextForUser(input: {
    userId: string;
  }): Promise<DistillationCrossDeviceResult> {
    const job =
      await this.queue.findNextUnconsumedTerminalForWorkflow({
        userId: input.userId,
        workflowKind: "distillation",
      });
    if (!job?.workflow) return { outcome: "idle" };

    const workflow = requireWorkflow(job);
    if (job.command.task_kind !== "distillation") {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "invalid_model_output",
        runId: workflow.runId,
      };
    }
    if (job.status === "failed") {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "model_failed",
        runId: workflow.runId,
      };
    }

    let window: DistillationWindow;
    let memories: ReturnType<
      typeof parseClaudeCodeDistillationOutput
    >["memories"];
    try {
      window = readWorkflowWindow(workflow.payload);
      if (!job.resultText) {
        throw new Error("Distillation result text is missing.");
      }
      memories =
        parseClaudeCodeDistillationOutput(job.resultText).memories;
    } catch {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "invalid_model_output",
        runId: workflow.runId,
      };
    }

    const conversation = await this.conversations.getConversation({
      userId: input.userId,
      conversationId: window.conversationId,
    });
    if (!conversation) {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "source_superseded",
        runId: workflow.runId,
      };
    }

    const currentWatermark = await this.port.getWatermark({
      userId: input.userId,
      subjectId: job.subjectId,
      conversationId: window.conversationId,
    });
    if (
      currentWatermark !== window.expectedPreviousWatermarkMessageId
    ) {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "conflict",
        runId: workflow.runId,
      };
    }

    let currentWindow: DistillationWindow | null = null;
    try {
      currentWindow = planDistillationWindow({
        conversation,
        surfaceLimit: this.config.surfaceLimit,
        previousWatermarkMessageId:
          window.expectedPreviousWatermarkMessageId,
      });
    } catch {
      // Canonical branch/path changed while the model task was in flight.
    }
    if (!currentWindow || !sameWindow(currentWindow, window)) {
      await this.queue.markConsumed({
        userId: input.userId,
        taskId: job.id,
      });
      return {
        outcome: "source_superseded",
        runId: workflow.runId,
      };
    }

    const committed = await commitDistillationDrafts({
      port: this.port,
      config: this.config,
      userId: input.userId,
      subjectId: job.subjectId,
      window,
      drafts: memories,
      processRunId: workflow.runId,
    });

    await this.queue.markConsumed({
      userId: input.userId,
      taskId: job.id,
    });

    if (committed.outcome === "conflict") {
      return {
        outcome: "conflict",
        runId: workflow.runId,
      };
    }
    if (committed.outcome !== "committed") {
      throw new Error(
        "Cross-device Distillation commit returned an impossible outcome.",
      );
    }
    return {
      outcome: "committed",
      runId: workflow.runId,
      sourceHeadMessageId: committed.sourceHeadMessageId,
      createdStateIds: committed.createdStateIds,
      resetFromSupersededWatermark:
        committed.resetFromSupersededWatermark,
    };
  }
}

function workflowTaskId(runId: string): string {
  const digest = createHash("sha256")
    .update(
      "leileios:distillation-xdevice:v1:" + runId,
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

function requireWorkflow(job: NativeLiveBackgroundModelJob) {
  if (!job.workflow || job.workflow.kind !== "distillation") {
    throw new Error("Distillation workflow metadata is missing.");
  }
  return job.workflow;
}

function readWorkflowWindow(
  value: Record<string, unknown>,
): DistillationWindow {
  if (
    value.version !== 1
    || typeof value.conversation_id !== "string"
    || typeof value.source_head_message_id !== "string"
    || (
      value.expected_previous_watermark_message_id !== null
      && typeof value.expected_previous_watermark_message_id
        !== "string"
    )
    || typeof value.reset_from_superseded_watermark !== "boolean"
    || !Array.isArray(value.transcript)
  ) {
    throw new Error("Distillation workflow payload is invalid.");
  }

  return {
    conversationId: requireNonblank(
      value.conversation_id,
      "conversation_id",
    ),
    sourceHeadMessageId: requireNonblank(
      value.source_head_message_id,
      "source_head_message_id",
    ),
    expectedPreviousWatermarkMessageId:
      value.expected_previous_watermark_message_id,
    resetFromSupersededWatermark:
      value.reset_from_superseded_watermark,
    transcript: value.transcript.map(readTranscriptMessage),
  };
}

function readTranscriptMessage(
  value: unknown,
): DistillationTranscriptMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Distillation transcript snapshot is invalid.");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.messageId !== "string"
    || (item.role !== "user" && item.role !== "assistant")
    || typeof item.text !== "string"
  ) {
    throw new Error("Distillation transcript snapshot is invalid.");
  }
  return {
    messageId: requireNonblank(item.messageId, "messageId"),
    role: item.role,
    text: item.text,
  };
}

function sameWindow(
  left: DistillationWindow,
  right: DistillationWindow,
): boolean {
  return (
    left.conversationId === right.conversationId
    && left.sourceHeadMessageId === right.sourceHeadMessageId
    && left.expectedPreviousWatermarkMessageId
      === right.expectedPreviousWatermarkMessageId
    && left.resetFromSupersededWatermark
      === right.resetFromSupersededWatermark
    && left.transcript.length === right.transcript.length
    && left.transcript.every((message, index) => {
      const other = right.transcript[index];
      return Boolean(
        other
        && other.messageId === message.messageId
        && other.role === message.role
        && other.text === message.text
      );
    })
  );
}

function requireNonblank(
  value: string,
  field: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(
      "Distillation workflow " + field + " must not be blank.",
    );
  }
  return normalized;
}
