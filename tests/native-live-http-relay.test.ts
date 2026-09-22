import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type {
  NativeLiveFinalizeResult,
  NativeLivePrepareResult,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import {
  createNativeLiveApiRouter,
} from "../src/web-api/native-live-router.js";
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
  result: NativeLivePrepareResult = {
    ok: true,
    outcome: "created",
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
      canonicalStatus: "finalized_success" as const,
      dispatchStatus: "completed" as const,
      failureCode: null,
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
        prepareId,
        requestId,
        conversationId,
        userMessageId,
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
          assistantMessage: { blocks: Array<{ text: string | null }> } | null;
        };
      };
      assert.equal(readPayload.data.canonicalStatus, "finalized_success");
      assert.equal(readPayload.data.dispatchStatus, "completed");
      assert.equal(readPayload.data.assistantMessage?.blocks[0]?.text, "VISIBLE");
      assert.deepEqual(turnReader.calls, [{ userId, prepareId }]);
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
