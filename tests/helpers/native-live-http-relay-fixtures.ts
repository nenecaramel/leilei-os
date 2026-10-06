import express from "express";
import type {
  AddressInfo,
} from "node:net";
import type {
  NativeLiveFinalizeResult,
} from "../../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveRelayPrepareResult,
} from "../../src/domains/bridge/relay/native-live-backend-relay-prepare.js";
import type {
  NativeLiveCurrentPathSnapshot,
} from "../../src/domains/conversation/native-live-current-path-read-repository.js";

export const userId = "11111111-1111-4111-8111-111111111111";

export const listenerId = "22222222-2222-4222-8222-222222222222";

export const prepareId = "33333333-3333-4333-8333-333333333333";

export const requestId = "44444444-4444-4444-8444-444444444444";

export const conversationId = "55555555-5555-4555-8555-555555555555";

export const userMessageId = "66666666-6666-4666-8666-666666666666";

export class FakeCoordinator {
  prepareCalls: unknown[] = [];
  result: NativeLiveRelayPrepareResult = {
    ok: true,
    outcome: "created",
    semanticPending: false,
    command: {
      protocol_version: 4,
      dispatch_target: "claude_code",
      prepare_id: prepareId,
      request_id: requestId,
      operation: "send",
      conversation_id: conversationId,
      canonical_user_message_id: userMessageId,
      runtime_mode: "new",
      parent_provider_session_id: null,
      prompt: "private prompt",
    },
  };

  async prepare(user: string, body: unknown) {
    this.prepareCalls.push({ user, body });
    return this.result;
  }
}

export class FakeTurnReader {
  calls: unknown[] = [];

  async readTurn(input: unknown) {
    this.calls.push(input);
    return {
      prepareId,
      requestId,
      conversationId,
      operation: "send" as const,
      canonicalUserMessageId: userMessageId,
      expectedWorkingDirectory: null,
      executionSelection: {
        model: "claude-opus-5-5" as const,
        thinking: "adaptive" as const,
        effort: "high" as const,
      },
      canonicalStatus: "finalized_success" as const,
      dispatchStatus: "completed" as const,
      semanticStatus: null,
      semanticFallbackCode: null,
      failureCode: null,
      runtimeMetadata: {
        context_usage: null,
        execution: {
          readback: {
            requested: {
              model: "claude-opus-5-5",
              thinking: "adaptive",
              effort: "high",
            },
            applied: {
              model: "claude-opus-5-5",
              effort: "high",
            },
            capability: null,
          },
          readback_error: null,
        },
      },
      assistantMessage: {
        id: "77777777-7777-4777-8777-777777777777",
        conversationId,
        parentMessageId: userMessageId,
        role: "assistant" as const,
        status: "completed" as const,
        createdAt: "2026-09-22T13:00:00.000Z",
        completedAt: "2026-09-22T13:00:01.000Z",
        blocks: [{
          id: "99999999-9999-4999-8999-999999999999",
          ordinal: 0,
          kind: "text" as const,
          rawType: "text",
          text: "VISIBLE",
          payload: null,
          createdAt: "2026-09-22T13:00:01.000Z",
        }],
      },
    };
  }
}

export class FakeCurrentPathReader {
  calls: unknown[] = [];
  result: NativeLiveCurrentPathSnapshot | null = {
    conversationId,
    title: "Native chat",
    currentHeadMessageId:
      "77777777-7777-4777-8777-777777777777",
    updatedAt: "2026-09-23T12:00:00.000Z",
    syncToken:
      "head:77777777-7777-4777-8777-777777777777",
    truncated: false,
    messages: [{
      id: "77777777-7777-4777-8777-777777777777",
      conversationId,
      parentMessageId: userMessageId,
      role: "assistant",
      status: "completed",
      createdAt: "2026-09-23T11:59:59.000Z",
      completedAt: "2026-09-23T12:00:00.000Z",
      blocks: [{
        id: "99999999-9999-4999-8999-999999999999",
        ordinal: 0,
        kind: "text",
        rawType: "runtime_proactivity",
        text: "VISIBLE PROACTIVE",
        payload: null,
        createdAt: "2026-09-23T12:00:00.000Z",
      }],
    }],
  };

  async readCurrentPath(input: unknown) {
    this.calls.push(input);
    return this.result;
  }
}

export class FakeRelayService {
  calls: Array<{ name: string; input: unknown }> = [];

  async enqueuePreparation(input: unknown) {
    this.calls.push({ name: "enqueuePreparation", input });
  }

  async renewLease(input: unknown) {
    this.calls.push({ name: "renewLease", input });
    return "acquired" as const;
  }

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return {
      reservationId: prepareId,
      command: {
        protocol_version: 4 as const,
        dispatch_target: "claude_code" as const,
        prepare_id: prepareId,
        request_id: requestId,
        operation: "send" as const,
        conversation_id: conversationId,
        canonical_user_message_id: userMessageId,
        runtime_mode: "new" as const,
        parent_provider_session_id: null,
        prompt: "private prompt",
      },
    };
  }

  async markExecutionStarted(input: unknown) {
    this.calls.push({ name: "markExecutionStarted", input });
  }

  async submitResult(input: unknown): Promise<NativeLiveFinalizeResult> {
    this.calls.push({ name: "submitResult", input });
    return {
      ok: true,
      outcome: "completed",
      requestId,
      operation: "send",
      conversationId,
      userMessageId,
      assistantMessageId: "77777777-7777-4777-8777-777777777777",
      checkpointId: "88888888-8888-4888-8888-888888888888",
      providerSessionId: "provider-new",
    };
  }

  async markResultDeliveryUnknown(input: unknown) {
    this.calls.push({ name: "markResultDeliveryUnknown", input });
  }

  async rejectReservation(input: unknown) {
    this.calls.push({ name: "rejectReservation", input });
  }
}

export class FakeRuntimeInteractionService {
  createCalls: unknown[] = [];
  waitCalls: unknown[] = [];
  listCalls: unknown[] = [];
  resolveCalls: unknown[] = [];
  cancelCalls: unknown[] = [];

  async create(input: unknown) {
    this.createCalls.push(input);
    return {
      outcome: "created" as const,
      interaction: {
        interactionId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        prepareId,
        kind: "permission" as const,
        request: {
          toolName: "Write",
          input: { file_path: "/tmp/a" },
        },
        status: "pending" as const,
        response: null,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        resolvedAt: null,
        cancelledAt: null,
      },
    };
  }

  async waitForListener(input: unknown) {
    const value = input as {
      userId: string;
      listenerInstanceId: string;
      reservationId: string;
      interactionId: string;
      timeoutMs: number;
      signal?: AbortSignal | null;
    };
    this.waitCalls.push({
      userId: value.userId,
      listenerInstanceId: value.listenerInstanceId,
      reservationId: value.reservationId,
      interactionId: value.interactionId,
      timeoutMs: value.timeoutMs,
      hasSignal: value.signal instanceof AbortSignal,
    });
    return {
      outcome: "terminal" as const,
      interaction: this.resolvedInteraction(),
    };
  }

  async listForUser(input: unknown) {
    this.listCalls.push(input);
    return [this.resolvedInteraction()];
  }

  async resolve(input: unknown) {
    this.resolveCalls.push(input);
    return {
      outcome: "resolved" as const,
      interaction: this.resolvedInteraction(),
    };
  }

  async cancelForListener(input: unknown) {
    this.cancelCalls.push(input);
    return "cancelled" as const;
  }

  private resolvedInteraction() {
    return {
      interactionId:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      prepareId,
      kind: "permission" as const,
      request: {
        toolName: "Write",
        input: { file_path: "/tmp/a" },
      },
      status: "resolved" as const,
      response: { decision: "allow" as const },
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:01.000Z",
      resolvedAt: "2026-09-25T00:00:01.000Z",
      cancelledAt: null,
    };
  }
}

export class FakeRuntimeEventService {
  appendBatchCalls: unknown[] = [];
  listCalls: unknown[] = [];

  async appendBatch(input: unknown) {
    this.appendBatchCalls.push(input);
    return { created: 2, idempotent: 0 };
  }

  async list(input: unknown) {
    this.listCalls.push(input);
    return [{
      sequence: 2,
      event: {
        type: "partial_text" as const,
        payload: {
          delta: "lo",
          accumulated_length: 5,
        },
      },
      createdAt: "2026-09-25T00:00:00.000Z",
    }];
  }
}

export class FakeBackgroundModelService {
  calls: Array<{ name: string; input: unknown }> = [];

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return {
      reservationId: prepareId,
      command: {
        protocol_version: 1 as const,
        task_id: prepareId,
        task_kind: "proactivity_deliberate" as const,
        prompt_contract_version: "proactivity-wake-deliberation-v1",
        prompt: "evaluate",
      },
    };
  }

  async submitResult(input: unknown) {
    this.calls.push({ name: "submitResult", input });
    return { status: "completed" as const };
  }
}

export class FakeBackgroundOpportunity {
  calls: unknown[] = [];
  result: unknown = {
    outcome: "attempted",
    attemptedAt: "2026-09-23T04:00:00.000Z",
    nextEligibleAt: "2026-09-23T04:01:00.000Z",
    result: { outcome: "idle" },
  };

  async offer(input: unknown) {
    this.calls.push(input);
    return this.result;
  }
}

export class FakeSemanticService {
  calls: Array<{ name: string; input: unknown }> = [];

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return {
      reservationId: prepareId,
      query: "solo travel independent",
      candidates: [{
        stateId: "state-travel",
        kind: "memory" as const,
        text: "独自旅行让我觉得自己可以照顾好自己",
      }],
    };
  }

  async submitScores(input: unknown) {
    this.calls.push({ name: "submitScores", input });
  }

  async submitFallback(input: unknown) {
    this.calls.push({ name: "submitFallback", input });
  }
}

export async function withServer(
  configure: (app: express.Express) => void,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
