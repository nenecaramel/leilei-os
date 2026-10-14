import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  nativeLiveRuntimeListenerLeases,
  runtimeContextManifests,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import {
  DrizzleNativeLiveMindFollowUpRepository,
  NativeLiveMindFollowUpService,
} from "../src/domains/bridge/mind/native-live-mind-followup.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  NativeLiveBackendRelayPrepareCoordinator,
} from "../src/domains/bridge/relay/native-live-backend-relay-prepare.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
} from "../src/domains/bridge/mind/native-live-semantic-handshake.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import { createDefaultBackendMindRuntime } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { createNativeLiveApiRouter } from "../src/web-api/native-live-router.js";
import type { NativeLiveRuntimeCommand } from "../src/domains/bridge/protocol/native-live-runtime-protocol.js";
import { createNativeLiveRelayInternalRouter } from "../src/web-api/native-live-relay-internal-router.js";

const enabled = process.env.RUN_NATIVE_LIVE_HTTP_DATABASE_TEST === "1";

async function withServer(
  userId: string,
  input: {
    coordinator: NativeLiveBackendRelayPrepareCoordinator;
    relayService: NativeLiveBackendRelayService;
    semanticService: NativeLiveSemanticHandshakeService;
    turnReader: DrizzleNativeLiveBackendTurnPort;
  },
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (request.path.startsWith("/api/v1/native-live")) {
      request.webUserId = userId;
    }
    if (request.path.startsWith("/internal/native-live-relay")) {
      request.mcpUserId = userId;
    }
    next();
  });
  app.use(
    "/api/v1/native-live",
    createNativeLiveApiRouter({
      coordinator: input.coordinator,
      relayService: input.relayService,
      turnReader: input.turnReader,
    }),
  );
  app.use(
    "/internal/native-live-relay",
    createNativeLiveRelayInternalRouter({
      relayService: input.relayService,
      semanticService: input.semanticService,
    }),
  );

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

test(
  "HTTP relay preserves Hook/MCP ownership through canonical callback, receipt replay and exact resume",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let cleanupUserId: string | null = null;
    t.after(async () => {
      try {
        if (cleanupUserId) {
          await database.db
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, cleanupUserId));
          await database.db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, cleanupUserId));
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, cleanupUserId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, cleanupUserId));
          await database.db
            .delete(users)
            .where(eq(users.id, cleanupUserId));
        }
      } finally {
        await database.close();
      }
    });

    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-http-${suffix}@example.com`,
        displayName: "Native Live HTTP",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId: user.id,
      title: "HTTP relay E2E",
    });

    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
    const backendMind = createDefaultBackendMindRuntime(database.db);
    const mindFollowUp = new NativeLiveMindFollowUpService(
      new DrizzleNativeLiveMindFollowUpRepository(database.db),
      turnPort,
      backendMind,
      crypto.randomUUID(),
    );
    const finalizeCoordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      mindFollowUp,
    );
    const relayService = new NativeLiveBackendRelayService(
      new DrizzleNativeLiveBackendRelayRepository(database.db),
      finalizeCoordinator,
    );
    const semanticService = new NativeLiveSemanticHandshakeService(
      new DrizzleNativeLiveSemanticScoringRepository(database.db),
      turnPort,
      backendMind,
      relayService,
    );
    const coordinator = new NativeLiveBackendRelayPrepareCoordinator(
      turnPort,
      backendMind,
      semanticService,
    );

    await withServer(
      user.id,
      { coordinator, relayService, semanticService, turnReader: turnPort },
      async (baseUrl) => {
        const post = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const listenerId = crypto.randomUUID();
        const firstRequestId = crypto.randomUUID();
        const firstText = "please remember the HTTP relay memory";
        const prepareRequest = {
          dispatch_target: "claude_code", request_id: firstRequestId, operation: "send",
          conversation_id: conversation.id, expected_head_message_id: null, text: firstText,
        };
        const prepared = await post("/api/v1/native-live/prepare", prepareRequest);
        assert.equal(prepared.status, 201);
        const preparedPayload = await prepared.json() as { data: { prepareId: string; userMessageId: string; semanticPending: boolean } };
        assert.equal(preparedPayload.data.semanticPending, false, "Hook owns automatic recall; backend does not stage another semantic pass");
        const replayedPrepare = await post("/api/v1/native-live/prepare", prepareRequest);
        assert.equal(replayedPrepare.status, 200);
        assert.equal((await replayedPrepare.json() as typeof preparedPayload).data.prepareId, preparedPayload.data.prepareId);
        assert.equal((await post("/api/v1/native-live/prepare", { ...prepareRequest, text: "changed" })).status, 409);
        const lease = await post("/internal/native-live-relay/lease/renew", { listener_instance_id: listenerId, dispatch_target: "claude_code" });
        assert.equal(lease.status, 200);
        const reserve = () => post("/internal/native-live-relay/reserve", { listener_instance_id: listenerId, dispatch_target: "claude_code" });
        const reserved = await reserve();
        assert.equal(reserved.status, 200);
        const reservedPayload = await reserved.json() as { data: { reservationId: string; command: NativeLiveRuntimeCommand } };
        const command = reservedPayload.data.command;
        assert.equal(reservedPayload.data.reservationId, preparedPayload.data.prepareId);
        assert.equal(command.prompt, firstText, "ordinary prompt reaches the installed Hook unchanged");
        assert.equal(command.parent_provider_checkpoint_id, null);
        assert.equal(command.runtime_mode, "new");
        const started = await post(`/internal/native-live-relay/reservations/${command.prepare_id}/execution-started`, { listener_instance_id: listenerId });
        assert.equal(started.status, 200);
        const visibleText = "VISIBLE <memory>HTTP relay memory</memory>";
        const checkpointId = crypto.randomUUID();
        const result = {
          protocol_version: command.protocol_version, prepare_id: command.prepare_id, request_id: command.request_id,
          conversation_id: command.conversation_id, status: "success", provider_session_id: crypto.randomUUID(),
          provider_checkpoint_id: checkpointId,
          normalized_events: [{ type: "text", payload: { text: visibleText } },
            { type: "result", payload: { status: "success", final_text: visibleText } }],
        };
        const submit = (body: unknown) => post(`/internal/native-live-relay/reservations/${command.prepare_id}/result`, body);
        const body = { listener_instance_id: listenerId, result };
        assert.equal((await submit({ ...body, listener_instance_id: crypto.randomUUID() })).status, 409,
          "another listener cannot publish a canonical reply");
        const { provider_checkpoint_id: _checkpoint, ...legacyResult } = result;
        const expectFinalizeRejected = async (response: Response, finalizeCode: string) => {
          assert.equal(response.status, 503);
          const payload = await response.json() as { success: boolean; error: { code: string; finalizeCode: string } };
          assert.equal(payload.success, false);
          assert.equal(payload.error.code, "FINALIZE_REJECTED");
          assert.equal(payload.error.finalizeCode, finalizeCode);
        };
        await expectFinalizeRejected(await submit({ ...body, result: legacyResult }), "RESULT_MISMATCH");
        await expectFinalizeRejected(await submit({ ...body, result: { ...result, provider_checkpoint_id: "invalid" } }), "INVALID_RESULT");
        assert.equal((await conversationService.getConversation({ userId: user.id, conversationId: conversation.id }))?.currentHeadMessageId, null);
        const callback = await submit(body);
        assert.equal(callback.status, 200);
        assert.deepEqual(await callback.json(), { success: true, data: { accepted: true, canonicalOutcome: "completed" } });
        const callbackReplay = await submit(body);
        assert.equal(callbackReplay.status, 200);
        assert.deepEqual(await callbackReplay.json(), { success: true, data: { accepted: true, canonicalOutcome: "idempotent" } });
        const read = await fetch(`${baseUrl}/api/v1/native-live/turns/${command.prepare_id}`);
        assert.equal(read.status, 200);
        const readPayload = await read.json() as { data: { canonicalStatus: string; dispatchStatus: string; assistantMessage: { id: string; blocks: Array<{ text: string | null }> } } };
        assert.equal(readPayload.data.canonicalStatus, "finalized_success");
        assert.equal(readPayload.data.dispatchStatus, "completed");
        assert.equal(readPayload.data.assistantMessage.blocks[0]?.text, visibleText,
          "tags are prose; only a successful MCP write can create Memory");
        const checkpoints = await database.db.select().from(conversationProviderSessionCheckpoints)
          .where(eq(conversationProviderSessionCheckpoints.conversationId, conversation.id));
        assert.equal(checkpoints.length, 1);
        assert.equal(checkpoints[0].canonicalMessageId, readPayload.data.assistantMessage.id);
        assert.equal(checkpoints[0].providerSessionId, result.provider_session_id);
        assert.equal(checkpoints[0].providerCheckpointId, checkpointId);
        const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
        assert.equal(messages.filter(message => message.role === "assistant").length, 1, "receipt replay cannot duplicate a reply");
        assert.deepEqual(await database.db.select().from(runtimeSubjectStates).where(and(eq(runtimeSubjectStates.userId, user.id), eq(runtimeSubjectStates.kind, "memory"))), [],
          "relay does not forge a Memory write from output tags");
        assert.deepEqual(await database.db.select().from(runtimeContextManifests).where(eq(runtimeContextManifests.userId, user.id)), [],
          "backend does not forge Hook recall receipts");
        await withServer(crypto.randomUUID(), { coordinator, relayService, semanticService, turnReader: turnPort }, async foreignUrl => {
          assert.equal((await fetch(`${foreignUrl}/api/v1/native-live/turns/${command.prepare_id}`)).status, 404);
          const foreignCallback = await fetch(`${foreignUrl}/internal/native-live-relay/reservations/${command.prepare_id}/result`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
          });
          assert.equal(foreignCallback.status, 409, "foreign tenant cannot replay an owner's receipt");
        });
        const secondText = "what was that earlier experience about?";
        const secondPrepared = await post("/api/v1/native-live/prepare", {
          ...prepareRequest, request_id: crypto.randomUUID(), expected_head_message_id: readPayload.data.assistantMessage.id, text: secondText,
        });
        assert.equal(secondPrepared.status, 201);
        assert.equal((await secondPrepared.json() as typeof preparedPayload).data.semanticPending, false);
        const secondReserved = await reserve();
        assert.equal(secondReserved.status, 200);
        const secondCommand = (await secondReserved.json() as typeof reservedPayload).data.command;
        assert.equal(secondCommand.prompt, secondText);
        assert.equal(secondCommand.runtime_mode, "resume");
        assert.equal(secondCommand.parent_provider_session_id, result.provider_session_id);
        assert.equal(secondCommand.parent_provider_checkpoint_id, checkpointId);
        assert.equal((await post(`/internal/native-live-relay/reservations/${secondCommand.prepare_id}/execution-started`, { listener_instance_id: listenerId })).status, 200);
        const secondResult = { ...result, prepare_id: secondCommand.prepare_id, request_id: secondCommand.request_id,
          provider_checkpoint_id: crypto.randomUUID(), normalized_events: [{ type: "text", payload: { text: "Next reply" } }] };
        const secondPath = `/internal/native-live-relay/reservations/${secondCommand.prepare_id}/result`;
        await expectFinalizeRejected(await post(secondPath, { listener_instance_id: listenerId,
          result: { ...secondResult, provider_session_id: crypto.randomUUID() } }), "RESULT_MISMATCH");
        assert.equal((await conversationService.getConversation({ userId: user.id, conversationId: conversation.id }))?.currentHeadMessageId,
          readPayload.data.assistantMessage.id, "rejected resume cannot advance the canonical head");
        const secondCallback = await post(secondPath, { listener_instance_id: listenerId, result: secondResult });
        assert.equal(secondCallback.status, 200);
        assert.deepEqual(await secondCallback.json(), { success: true, data: { accepted: true, canonicalOutcome: "completed" } });
        const current = await conversationService.getConversation({ userId: user.id, conversationId: conversation.id });
        assert.equal(current?.messages.length, 4);
        assert.equal(current?.messages.at(-1)?.blocks[0]?.text, "Next reply");
      },
    );
  },
);
