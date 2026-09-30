import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  NativeLiveFinalizeResult,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveRelayPrepareResult,
} from "../src/domains/bridge/native-live-backend-relay-prepare.js";
import {
  createNativeLiveApiRouter,
} from "../src/web-api/native-live-router.js";
import type {
  NativeLiveCurrentPathSnapshot,
} from "../src/domains/conversation/native-live-current-path-read-repository.js";
import {
  createNativeLiveRelayInternalRouter,
} from "../src/web-api/native-live-relay-internal-router.js";

const userId = "11111111-1111-4111-8111-111111111111";
const listenerId = "22222222-2222-4222-8222-222222222222";
const prepareId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";
const userMessageId = "66666666-6666-4666-8666-666666666666";

class FakeCoordinator {
  prepareCalls: unknown[] = [];
  result: NativeLiveRelayPrepareResult = {
    ok: true,
    outcome: "created",
    semanticPending: false,
    command: {
      protocol_version: 1,
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

class FakeTurnReader {
  calls: unknown[] = [];

  async readTurn(input: unknown) {
    this.calls.push(input);
    return {
      prepareId,
      requestId,
      conversationId,
      operation: "send" as const,
      canonicalUserMessageId: userMessageId,
      workspaceId: null,
      expectedWorkspaceRoot: null,
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

class FakeCurrentPathReader {
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

class FakeRelayService {
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
        protocol_version: 1 as const,
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

class FakeRuntimeInteractionService {
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

class FakeRuntimeEventService {
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

class FakeBackgroundModelService {
  calls: Array<{ name: string; input: unknown }> = [];

  async reserveNext(input: unknown) {
    this.calls.push({ name: "reserveNext", input });
    return {
      reservationId: prepareId,
      command: {
        protocol_version: 1 as const,
        task_id: prepareId,
        task_kind: "topic_resurface_evaluate" as const,
        prompt_contract_version: "topic-resurface-eval-v1",
        prompt: "evaluate",
      },
    };
  }

  async submitResult(input: unknown) {
    this.calls.push({ name: "submitResult", input });
    return { status: "completed" as const };
  }
}

class FakeBackgroundOpportunity {
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

class FakeSemanticService {
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

async function withServer(
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

test("web prepare endpoint is user scoped and never returns the runtime prompt", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({ coordinator, relayService, turnReader }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(unauthenticated.status, 401);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            dispatch_target: "claude_code",
            request_id: requestId,
            operation: "send",
            conversation_id: conversationId,
            expected_head_message_id: null,
            text: "hello",
          }),
        },
      );
      assert.equal(response.status, 201);
      const payload = await response.json() as {
        data: Record<string, unknown>;
      };
      assert.deepEqual(payload.data, {
        outcome: "created",
        semanticPending: false,
        prepareId,
        requestId,
        conversationId,
        userMessageId,
        workspaceId: null,
        expectedWorkspaceRoot: null,
      });
      assert.equal(JSON.stringify(payload).includes("private prompt"), false);
      assert.deepEqual(relayService.calls, [{
        name: "enqueuePreparation",
        input: { userId, prepareId },
      }]);

      const read = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(read.status, 200);
      const readPayload = await read.json() as {
        data: {
          canonicalStatus: string;
          dispatchStatus: string;
          executionSelection: {
            model: string;
            thinking?: string;
            effort?: string;
          } | null;
          runtimeMetadata: {
            execution?: {
              readback: {
                applied: {
                  model: string | null;
                  effort: string | null;
                };
              };
            } | null;
          } | null;
          assistantMessage: { blocks: Array<{ text: string | null }> } | null;
        };
      };
      assert.equal(readPayload.data.canonicalStatus, "finalized_success");
      assert.equal(readPayload.data.dispatchStatus, "completed");
      assert.deepEqual(readPayload.data.executionSelection, {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      });
      assert.equal(
        readPayload.data.runtimeMetadata?.execution?.readback.applied.model,
        "claude-opus-5-5",
      );
      assert.equal(readPayload.data.assistantMessage?.blocks[0]?.text, "VISIBLE");
      assert.deepEqual(turnReader.calls, [{ userId, prepareId }]);
    },
  );
});

test("web prepare maps Workspace selection failures without hiding them as infrastructure errors", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({ coordinator, relayService, turnReader }),
      );
    },
    async (baseUrl) => {
      const requestBody = {
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversationId,
        expected_head_message_id: null,
        workspace_id: "88888888-8888-4888-8888-888888888888",
        text: "hello",
      };

      for (const [code, expectedStatus] of [
        ["WORKSPACE_NOT_FOUND", 404],
        ["WORKSPACE_BINDING_AMBIGUOUS", 409],
        ["WORKSPACE_BINDING_CONFLICT", 409],
      ] as const) {
        coordinator.result = {
          ok: false,
          requestId,
          operation: "send",
          conversationId,
          code,
        };
        const response = await fetch(
          `${baseUrl}/api/v1/native-live/prepare`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-test-user": "owner",
            },
            body: JSON.stringify(requestBody),
          },
        );
        assert.equal(response.status, expectedStatus);
        const payload = await response.json() as {
          error: { code: string };
        };
        assert.equal(payload.error.code, code);
      }

      assert.deepEqual(relayService.calls, []);
    },
  );
});

test("web turn completion wait is user scoped and returns terminal state without polling", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const waitCalls: unknown[] = [];
  const turnWaitService = {
    async wait(input: {
      userId: string;
      prepareId: string;
      timeoutMs: number;
      signal?: AbortSignal | null;
    }) {
      waitCalls.push({
        userId: input.userId,
        prepareId: input.prepareId,
        timeoutMs: input.timeoutMs,
        hasSignal: input.signal instanceof AbortSignal,
      });
      const turn = await turnReader.readTurn({
        userId: input.userId,
        prepareId: input.prepareId,
      });
      return {
        outcome: "terminal" as const,
        turn: turn!,
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          turnWaitService,
        }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/wait`,
        { method: "POST" },
      );
      assert.equal(unauthenticated.status, 401);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/wait`,
        {
          method: "POST",
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        data: {
          outcome: string;
          turn: {
            prepareId: string;
            canonicalStatus: string;
            dispatchStatus: string;
            assistantMessage: {
              blocks: Array<{ text: string | null }>;
            } | null;
          };
        };
      };
      assert.equal(payload.data.outcome, "terminal");
      assert.equal(payload.data.turn.prepareId, prepareId);
      assert.equal(
        payload.data.turn.canonicalStatus,
        "finalized_success",
      );
      assert.equal(payload.data.turn.dispatchStatus, "completed");
      assert.equal(
        payload.data.turn.assistantMessage?.blocks[0]?.text,
        "VISIBLE",
      );
      assert.deepEqual(waitCalls, [{
        userId,
        prepareId,
        timeoutMs: 25_000,
        hasSignal: true,
      }]);
    },
  );
});

test("web current-path endpoint is authenticated, bounded, and supports head ETag refresh", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const currentPathReader = new FakeCurrentPathReader();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          currentPathReader,
        }),
      );
    },
    async (baseUrl) => {
      const unauthenticated = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path`,
      );
      assert.equal(unauthenticated.status, 401);

      const invalidId = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/not-a-uuid/current-path`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(invalidId.status, 400);

      const invalidLimit = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=201`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(invalidLimit.status, 400);

      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=2`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("etag"),
        '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
      );
      const payload = await response.json() as {
        data: {
          conversationId: string;
          currentHeadMessageId: string | null;
          syncToken: string;
          truncated: boolean;
          messages: Array<{
            blocks: Array<{ text: string | null }>;
          }>;
        };
      };
      assert.equal(payload.data.conversationId, conversationId);
      assert.equal(
        payload.data.currentHeadMessageId,
        "77777777-7777-4777-8777-777777777777",
      );
      assert.equal(
        payload.data.syncToken,
        "head:77777777-7777-4777-8777-777777777777",
      );
      assert.equal(payload.data.truncated, false);
      assert.equal(
        payload.data.messages[0]?.blocks[0]?.text,
        "VISIBLE PROACTIVE",
      );
      assert.deepEqual(currentPathReader.calls, [{
        userId,
        conversationId,
        limit: 2,
      }]);

      const unchanged = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=2`,
        {
          headers: {
            "x-test-user": "owner",
            "if-none-match":
              '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
          },
        },
      );
      assert.equal(unchanged.status, 304);
      assert.equal(
        currentPathReader.calls.length,
        2,
      );

      const widerWindow = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=3`,
        {
          headers: {
            "x-test-user": "owner",
            "if-none-match":
              '"head:77777777-7777-4777-8777-777777777777:limit:2:before:-:after:-"',
          },
        },
      );
      assert.equal(widerWindow.status, 200);
      assert.equal(
        widerWindow.headers.get("etag"),
        '"head:77777777-7777-4777-8777-777777777777:limit:3:before:-:after:-"',
      );
      assert.deepEqual(
        currentPathReader.calls[2],
        { userId, conversationId, limit: 3 },
      );
    },
  );
});

test("web current-path endpoint returns 404 for a missing user-owned native conversation", async () => {
  const currentPathReader = new FakeCurrentPathReader();
  currentPathReader.result = null;

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.webUserId = userId;
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator: new FakeCoordinator(),
          relayService: new FakeRelayService(),
          turnReader: new FakeTurnReader(),
          currentPathReader,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path`,
      );
      assert.equal(response.status, 404);
    },
  );
});

test("web prepare leaves semantic-pending turns staged instead of exposing them to Claude", async () => {
  const coordinator = new FakeCoordinator();
  coordinator.result = {
    ...(coordinator.result as Extract<NativeLiveRelayPrepareResult, { ok: true }>),
    semanticPending: true,
  };
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.webUserId = userId;
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({ coordinator, relayService, turnReader }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/prepare`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dispatch_target: "claude_code",
            request_id: requestId,
            operation: "send",
            conversation_id: conversationId,
            expected_head_message_id: null,
            text: "hello",
          }),
        },
      );

      assert.equal(response.status, 202);
      const payload = await response.json() as {
        data: { semanticPending: boolean };
      };
      assert.equal(payload.data.semanticPending, true);
      assert.deepEqual(relayService.calls, []);
    },
  );
});

test("internal relay reserve and result endpoints preserve listener ownership data", async () => {
  const relayService = new FakeRelayService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({ relayService }),
      );
    },
    async (baseUrl) => {
      const lease = await fetch(
        `${baseUrl}/internal/native-live-relay/lease/renew`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(lease.status, 200);

      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const reservedPayload = await reserve.json() as {
        data: { reservationId: string; command: { prompt: string } };
      };
      assert.equal(reservedPayload.data.reservationId, prepareId);
      assert.equal(reservedPayload.data.command.prompt, "private prompt");

      const started = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/execution-started`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listener_instance_id: listenerId }),
        },
      );
      assert.equal(started.status, 200);

      const result = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            result: {
              protocol_version: 1,
              prepare_id: prepareId,
              request_id: requestId,
              conversation_id: conversationId,
              status: "failure",
              error_code: "CLAUDE_PROCESS_FAILED",
            },
          }),
        },
      );
      assert.equal(result.status, 200);
      assert.deepEqual(
        relayService.calls.map((entry) => entry.name),
        [
          "renewLease",
          "reserveNext",
          "markExecutionStarted",
          "submitResult",
        ],
      );
    },
  );
});

test("internal relay work wait renews the listener lease and waits in authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const waitCalls: unknown[] = [];
  const workWaitService = {
    async wait(input: {
      userId: string;
      timeoutMs: number;
      signal?: AbortSignal | null;
    }) {
      waitCalls.push({
        userId: input.userId,
        timeoutMs: input.timeoutMs,
        aborted: input.signal?.aborted ?? false,
      });
      return {
        outcome: "ready" as const,
        version: 7,
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          workWaitService,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/work/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json() as { data: unknown }).data,
        { outcome: "ready", version: 7 },
      );
      assert.deepEqual(relayService.calls[0], {
        name: "renewLease",
        input: {
          userId,
          listenerInstanceId: listenerId,
          dispatchTarget: "claude_code",
        },
      });
      assert.deepEqual(waitCalls, [{
        userId,
        timeoutMs: 45_000,
        aborted: false,
      }]);
    },
  );
});

test("internal relay semantic endpoints preserve the bounded candidate snapshot and score ids", async () => {
  const relayService = new FakeRelayService();
  const semanticService = new FakeSemanticService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          semanticService,
        }),
      );
    },
    async (baseUrl) => {
      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/semantic/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const reservation = await reserve.json() as {
        data: {
          reservationId: string;
          candidates: Array<{ stateId: string }>;
        };
      };
      assert.equal(reservation.data.reservationId, prepareId);
      assert.deepEqual(
        reservation.data.candidates.map((candidate) => candidate.stateId),
        ["state-travel"],
      );

      const scores = await fetch(
        `${baseUrl}/internal/native-live-relay/semantic/reservations/${prepareId}/scores`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            scores: { "state-travel": 0.93 },
          }),
        },
      );
      assert.equal(scores.status, 200);
      assert.deepEqual(
        semanticService.calls.map((entry) => entry.name),
        ["reserveNext", "submitScores"],
      );
    },
  );
});

test("internal relay rejects malformed listener identity before calling the service", async () => {
  const relayService = new FakeRelayService();
  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({ relayService }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: "not-a-uuid",
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 400);
      assert.equal(relayService.calls.length, 0);
    },
  );
});


test("internal relay background model endpoints preserve authenticated user scope without exposing it to Mac command", async () => {
  const relayService = new FakeRelayService();
  const backgroundModelService = new FakeBackgroundModelService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          backgroundModelService,
        }),
      );
    },
    async (baseUrl) => {
      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);
      const payload = await reserve.json() as {
        data: {
          reservationId: string;
          command: Record<string, unknown>;
        };
      };
      assert.equal(payload.data.reservationId, prepareId);
      assert.equal("userId" in payload.data.command, false);
      assert.equal("user_id" in payload.data.command, false);
      assert.deepEqual(backgroundModelService.calls[0], {
        name: "reserveNext",
        input: {
          userId,
          listenerInstanceId: listenerId,
        },
      });

      const result = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/reservations/${prepareId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            result: {
              protocol_version: 1,
              task_id: prepareId,
              task_kind: "topic_resurface_evaluate",
              status: "success",
              final_text: '{"decision":"quiet"}',
            },
          }),
        },
      );
      assert.equal(result.status, 200);
      assert.deepEqual(backgroundModelService.calls[1], {
        name: "submitResult",
        input: {
          userId,
          listenerInstanceId: listenerId,
          taskId: prepareId,
          result: {
            protocol_version: 1,
            task_id: prepareId,
            task_kind: "topic_resurface_evaluate",
            status: "success",
            final_text: '{"decision":"quiet"}',
          },
        },
      });
    },
  );
});


test("internal relay companion background opportunity uses authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const calls: unknown[] = [];
  const observed: unknown[] = [];
  const companionBackgroundOpportunity = {
    async offer(input: unknown) {
      calls.push(input);
      return {
        reason: "startup" as const,
        maintenanceKinds: ["thought_evolution"],
        effectDeliveryScheduled: true,
        proactivityScheduled: false,
        topicResurfaceOffered: true,
        failures: [],
      };
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          companionBackgroundOpportunity,
          observeCompanionBackgroundOpportunity(event) {
            observed.push(event);
          },
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/background/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
            reason: "startup",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [{
        userId,
        reason: "startup",
      }]);
      const payload = await response.json() as {
        data: { reason: string };
      };
      assert.equal(payload.data.reason, "startup");
      assert.deepEqual(observed, [{
        outcome: "offered",
        reason: "startup",
        maintenanceKindCount: 1,
        effectDeliveryScheduled: true,
        proactivityScheduled: false,
        topicResurfaceOffered: true,
        failureCount: 0,
      }]);

      const malformed = await fetch(
        `${baseUrl}/internal/native-live-relay/background/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
            reason: "later",
          }),
        },
      );
      assert.equal(malformed.status, 400);
      assert.equal(calls.length, 1);
      assert.equal(observed.length, 1);
    },
  );
});

test("internal relay Topic resurface opportunity uses authenticated user scope and supports disabled mode", async () => {
  const relayService = new FakeRelayService();
  const backgroundModelService = new FakeBackgroundModelService();
  const opportunity = new FakeBackgroundOpportunity();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          backgroundModelService,
          backgroundModelOpportunity: opportunity,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/topic-resurface/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as { data: unknown };
      assert.deepEqual(payload.data, opportunity.result);
      assert.deepEqual(opportunity.calls, [{ userId }]);
    },
  );

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          backgroundModelService,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/background-model/topic-resurface/opportunity`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json() as { data: unknown }).data,
        { outcome: "disabled" },
      );
    },
  );
});


test("internal relay persists authenticated foreground runtime event batches", async () => {
  const relayService = new FakeRelayService();
  const runtimeEvents = new FakeRuntimeEventService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeEventService: runtimeEvents,
        }),
      );
    },
    async (baseUrl) => {
      const events = [
        {
          sequence: 1,
          event: {
            type: "partial_text" as const,
            payload: {
              delta: "hel",
              accumulated_length: 3,
            },
          },
        },
        {
          sequence: 2,
          event: {
            type: "result" as const,
            payload: {
              status: "success",
              final_text: "hello",
            },
          },
        },
      ];
      const response = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/events/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            events,
          }),
        },
      );
      assert.equal(response.status, 201);
      assert.deepEqual(runtimeEvents.appendBatchCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        events,
      }]);
    },
  );
});

test("web runtime event reads are owner scoped and cursor bounded", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const runtimeEvents = new FakeRuntimeEventService();

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeEventService: runtimeEvents,
        }),
      );
    },
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/events?after_sequence=1&limit=25`,
        {
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(response.status, 200);
      assert.equal(
        response.headers.get("cache-control"),
        "private, no-store",
      );
      const payload = await response.json() as {
        data: {
          nextAfterSequence: number;
          events: unknown[];
        };
      };
      assert.equal(payload.data.nextAfterSequence, 2);
      assert.equal(payload.data.events.length, 1);
      assert.deepEqual(runtimeEvents.listCalls, [{
        userId,
        prepareId,
        afterSequence: 1,
        limit: 25,
      }]);
    },
  );
});


test("internal relay creates and waits for listener-owned runtime interactions", async () => {
  const relayService = new FakeRelayService();
  const interactions = new FakeRuntimeInteractionService();
  const interactionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeInteractionService: interactions,
        }),
      );
    },
    async (baseUrl) => {
      const created = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/interactions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            interaction_id: interactionId,
            kind: "permission",
            request: {
              toolName: "Write",
              input: { file_path: "/tmp/a" },
            },
          }),
        },
      );
      assert.equal(created.status, 201);

      const read = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/interactions/${interactionId}/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
          }),
        },
      );
      assert.equal(read.status, 200);
      assert.deepEqual(interactions.createCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        interactionId,
        kind: "permission",
        request: {
          toolName: "Write",
          input: { file_path: "/tmp/a" },
        },
      }]);
      assert.deepEqual(interactions.waitCalls, [{
        userId,
        listenerInstanceId: listenerId,
        reservationId: prepareId,
        interactionId,
        timeoutMs: 25_000,
        hasSignal: true,
      }]);
    },
  );
});

test("web owner can list and resolve a pending runtime interaction", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const interactions = new FakeRuntimeInteractionService();
  const interactionId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeInteractionService: interactions,
        }),
      );
    },
    async (baseUrl) => {
      const listed = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/interactions?limit=10`,
        { headers: { "x-test-user": "owner" } },
      );
      assert.equal(listed.status, 200);

      const resolved = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/interactions/${interactionId}/respond`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            response: {
              decision: "allow",
              updatedInput: {
                file_path: "/allowed/a",
              },
            },
          }),
        },
      );
      assert.equal(resolved.status, 200);
      assert.deepEqual(interactions.listCalls, [{
        userId,
        prepareId,
        limit: 10,
      }]);
      assert.deepEqual(interactions.resolveCalls, [{
        userId,
        prepareId,
        interactionId,
        response: {
          decision: "allow",
          updatedInput: {
            file_path: "/allowed/a",
          },
        },
      }]);
    },
  );
});


test("internal relay waits for and completes listener-owned foreground controls", async () => {
  const relayService = new FakeRelayService();
  const controlId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls = [];
  const runtimeControlService = {
    async waitNextForListener(input: unknown) {
      const value = input as {
        userId: string;
        listenerInstanceId: string;
        reservationId: string;
        timeoutMs: number;
        signal?: AbortSignal | null;
      };
      calls.push({
        name: "wait",
        input: {
          userId: value.userId,
          listenerInstanceId: value.listenerInstanceId,
          reservationId: value.reservationId,
          timeoutMs: value.timeoutMs,
          hasSignal: value.signal instanceof AbortSignal,
        },
      });
      return {
        outcome: "reserved" as const,
        control: {
          controlId,
          prepareId,
          kind: "mid_turn_input" as const,
          payload: { text: "steer" },
          status: "reserved" as const,
          reservedBy: listenerId,
          receipt: null,
          failureCode: null,
          createdAt: "2026-09-25T00:00:00.000Z",
          updatedAt: "2026-09-25T00:00:00.000Z",
          appliedAt: null,
        },
      };
    },
    async completeForListener(input: unknown) {
      calls.push({ name: "complete", input });
      return "applied" as const;
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          runtimeControlService,
        }),
      );
    },
    async (baseUrl) => {
      const waited = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/controls/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
          }),
        },
      );
      assert.equal(waited.status, 200);
      const waitedPayload = await waited.json() as {
        data: {
          outcome: string;
          control: {
            controlId: string;
            kind: string;
            payload: Record<string, unknown>;
          };
        };
      };
      assert.equal(waitedPayload.data.outcome, "reserved");
      assert.deepEqual(waitedPayload.data.control, {
        controlId,
        prepareId,
        kind: "mid_turn_input",
        payload: { text: "steer" },
        status: "reserved",
        reservedBy: listenerId,
        receipt: null,
        failureCode: null,
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        appliedAt: null,
      });

      const completed = await fetch(
        `${baseUrl}/internal/native-live-relay/reservations/${prepareId}/controls/${controlId}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            outcome: {
              status: "applied",
              receipt: { status: "queued" },
            },
          }),
        },
      );
      assert.equal(completed.status, 200);
      assert.deepEqual(calls, [
        {
          name: "wait",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: prepareId,
            timeoutMs: 25_000,
            hasSignal: true,
          },
        },
        {
          name: "complete",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: prepareId,
            controlId,
            outcome: {
              status: "applied",
              receipt: { status: "queued" },
            },
          },
        },
      ]);
    },
  );
});

test("web owner can create and list foreground mid-turn and interrupt controls", async () => {
  const coordinator = new FakeCoordinator();
  const relayService = new FakeRelayService();
  const turnReader = new FakeTurnReader();
  const controlId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const calls = [];
  const control = {
    controlId,
    prepareId,
    kind: "interrupt" as const,
    payload: {},
    status: "pending" as const,
    reservedBy: null,
    receipt: null,
    failureCode: null,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    appliedAt: null,
  };
  const runtimeControlService = {
    async createForUser(input: unknown) {
      calls.push({ name: "create", input });
      return {
        outcome: "created" as const,
        control,
      };
    },
    async listForUser(input: unknown) {
      calls.push({ name: "list", input });
      return [control];
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        if (request.header("x-test-user") === "owner") {
          request.webUserId = userId;
        }
        next();
      });
      app.use(
        "/api/v1/native-live",
        createNativeLiveApiRouter({
          coordinator,
          relayService,
          turnReader,
          runtimeControlService,
        }),
      );
    },
    async (baseUrl) => {
      const created = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/controls`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-test-user": "owner",
          },
          body: JSON.stringify({
            control_id: controlId,
            kind: "interrupt",
            payload: {},
          }),
        },
      );
      assert.equal(created.status, 201);

      const listed = await fetch(
        `${baseUrl}/api/v1/native-live/turns/${prepareId}/controls?limit=10`,
        {
          headers: { "x-test-user": "owner" },
        },
      );
      assert.equal(listed.status, 200);
      assert.equal(
        listed.headers.get("cache-control"),
        "private, no-store",
      );
      assert.deepEqual(calls, [
        {
          name: "create",
          input: {
            userId,
            prepareId,
            controlId,
            kind: "interrupt",
            payload: {},
          },
        },
        {
          name: "list",
          input: {
            userId,
            prepareId,
            limit: 10,
          },
        },
      ]);
    },
  );
});


test("internal relay reserves and receipts provider session cleanup in authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const cleanupId = "77777777-7777-4777-8777-777777777777";
  const calls: Array<{ name: string; input: unknown }> = [];
  const providerSessionCleanupService = {
    async reserveNext(input: unknown) {
      calls.push({ name: "reserve", input });
      return {
        reservationId: cleanupId,
        providerSessionId: "provider-old-fork",
      };
    },
    async complete(input: unknown) {
      calls.push({ name: "complete", input });
      return "applied" as const;
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          providerSessionCleanupService,
        }),
      );
    },
    async (baseUrl) => {
      const reserved = await fetch(
        `${baseUrl}/internal/native-live-relay/provider-session-cleanup/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserved.status, 200);
      assert.deepEqual(
        (await reserved.json() as { data: unknown }).data,
        {
          reservationId: cleanupId,
          providerSessionId: "provider-old-fork",
        },
      );

      const completed = await fetch(
        `${baseUrl}/internal/native-live-relay/provider-session-cleanup/reservations/${cleanupId}/result`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            status: "success",
          }),
        },
      );
      assert.equal(completed.status, 200);
      assert.deepEqual(calls, [
        {
          name: "reserve",
          input: {
            userId,
            listenerInstanceId: listenerId,
          },
        },
        {
          name: "complete",
          input: {
            userId,
            listenerInstanceId: listenerId,
            reservationId: cleanupId,
            outcome: { status: "success" },
          },
        },
      ]);
    },
  );
});


test("internal relay Mind semantic grouping endpoints preserve authenticated user scope", async () => {
  const relayService = new FakeRelayService();
  const calls: Array<{ name: string; input: unknown }> = [];
  const grouping = {
    async reserveNext(input: unknown) {
      calls.push({ name: "reserveNext", input });
      return {
        reservationId: "99999999-9999-4999-8999-999999999999",
        query: "complete the backend cleanup",
        candidates: [{
          stateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          kind: "drive" as const,
          text: "finish the runtime cleanup",
        }],
      };
    },
    async acceptScores(input: unknown) {
      calls.push({ name: "acceptScores", input });
    },
    async acceptFallback(input: unknown) {
      calls.push({ name: "acceptFallback", input });
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService,
          mindSemanticGrouping: grouping,
        }),
      );
    },
    async (baseUrl) => {
      const reservationId = "99999999-9999-4999-8999-999999999999";
      const candidateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const reserve = await fetch(
        `${baseUrl}/internal/native-live-relay/mind-semantic-grouping/reserve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            dispatch_target: "claude_code",
          }),
        },
      );
      assert.equal(reserve.status, 200);

      const scores = await fetch(
        `${baseUrl}/internal/native-live-relay/mind-semantic-grouping/reservations/${reservationId}/scores`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            listener_instance_id: listenerId,
            scores: { [candidateId]: 0.93 },
          }),
        },
      );
      assert.equal(scores.status, 200);
      assert.deepEqual(calls, [{
        name: "reserveNext",
        input: {
          userId,
          listenerInstanceId: listenerId,
        },
      }, {
        name: "acceptScores",
        input: {
          userId,
          listenerInstanceId: listenerId,
          requestId: reservationId,
          scores: { [candidateId]: 0.93 },
        },
      }]);
    },
  );
});


test("internal relay output attachment upload endpoints stay user scoped", async () => {
  const attachmentId =
    "66666666-6666-4666-8666-666666666666";
  const calls: Array<{ name: string; input: unknown }> = [];
  const descriptor = {
    attachmentId,
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 321,
    sha256: "a".repeat(64),
    kind: "file" as const,
    status: "ready" as const,
    objectKey: "native-live/user/report",
    boundMessageId: null,
    createdAt: "2026-09-30T06:00:00.000Z",
    expiresAt: "2026-09-30T07:00:00.000Z",
  };
  const attachmentService = {
    async createUploadSlot(input: unknown) {
      calls.push({ name: "createUploadSlot", input });
      return {
        attachment: {
          ...descriptor,
          status: "uploading" as const,
        },
        upload: {
          url: "https://bucket.example/upload",
          method: "PUT" as const,
          headers: {
            "content-type": "application/pdf",
            "x-amz-meta-sha256": "a".repeat(64),
          },
          expiresAt: "2026-09-30T06:10:00.000Z",
        },
      };
    },
    async completeUpload(input: unknown) {
      calls.push({ name: "completeUpload", input });
      return descriptor;
    },
    async createDownloadSlot() {
      throw new Error("unused");
    },
  };

  await withServer(
    (app) => {
      app.use((request, _response, next) => {
        request.mcpUserId = userId;
        next();
      });
      app.use(
        "/internal/native-live-relay",
        createNativeLiveRelayInternalRouter({
          relayService: new FakeRelayService(),
          attachmentService,
        }),
      );
    },
    async (baseUrl) => {
      const upload = await fetch(
        `${baseUrl}/internal/native-live-relay/attachments/upload-slots`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: "report.pdf",
            mime_type: "application/pdf",
            size_bytes: 321,
            sha256: "a".repeat(64),
            kind: "file",
          }),
        },
      );
      assert.equal(upload.status, 201);
      const uploadPayload = await upload.json() as {
        data: { attachment: { attachmentId: string } };
      };
      assert.equal(
        uploadPayload.data.attachment.attachmentId,
        attachmentId,
      );

      const complete = await fetch(
        `${baseUrl}/internal/native-live-relay/attachments/${attachmentId}/complete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(complete.status, 200);
      const completePayload = await complete.json() as {
        data: { attachment: { status: string } };
      };
      assert.equal(
        completePayload.data.attachment.status,
        "ready",
      );
    },
  );

  assert.deepEqual(calls, [
    {
      name: "createUploadSlot",
      input: {
        userId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file",
      },
    },
    {
      name: "completeUpload",
      input: {
        userId,
        attachmentId,
      },
    },
  ]);
});
