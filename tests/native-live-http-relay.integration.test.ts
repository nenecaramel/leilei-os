import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveRuntimeListenerLeases,
  runtimeContextManifests,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/native-live-backend-relay.js";
import {
  DrizzleNativeLiveMindFollowUpRepository,
  NativeLiveMindFollowUpService,
} from "../src/domains/bridge/native-live-mind-followup.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import {
  NativeLiveBackendRelayPrepareCoordinator,
} from "../src/domains/bridge/native-live-backend-relay-prepare.js";
import {
  DrizzleNativeLiveSemanticScoringRepository,
  NativeLiveSemanticHandshakeService,
} from "../src/domains/bridge/native-live-semantic-handshake.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/native-live-backend-turn-repository.js";
import { createDefaultBackendMindRuntime } from "../src/domains/runtime/default-backend-mind-runtime.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { createNativeLiveApiRouter } from "../src/web-api/native-live-router.js";
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
  "HTTP relay closes prepare -> Mac callback -> visible assistant -> settled Breath recall loop",
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
        const listenerId = crypto.randomUUID();
        const firstRequestId = crypto.randomUUID();

        const prepared = await fetch(
          `${baseUrl}/api/v1/native-live/prepare`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dispatch_target: "claude_code",
              request_id: firstRequestId,
              operation: "send",
              conversation_id: conversation.id,
              expected_head_message_id: null,
              text: "please remember the HTTP relay memory",
            }),
          },
        );
        assert.equal(prepared.status, 201);
        const preparedPayload = await prepared.json() as {
          data: {
            prepareId: string;
            userMessageId: string;
          };
        };

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

        const reserved = await fetch(
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
        assert.equal(reserved.status, 200);
        const reservedPayload = await reserved.json() as {
          data: {
            reservationId: string;
            command: {
              prompt: string;
              request_id: string;
              conversation_id: string;
              prepare_id: string;
            };
          };
        };
        assert.equal(
          reservedPayload.data.reservationId,
          preparedPayload.data.prepareId,
        );
        assert.equal(
          reservedPayload.data.command.prompt.includes(
            '<leileios_context authority="data">',
          ),
          true,
        );

        const started = await fetch(
          `${baseUrl}/internal/native-live-relay/reservations/${preparedPayload.data.prepareId}/execution-started`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              listener_instance_id: listenerId,
            }),
          },
        );
        assert.equal(started.status, 200);

        const callback = await fetch(
          `${baseUrl}/internal/native-live-relay/reservations/${preparedPayload.data.prepareId}/result`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              listener_instance_id: listenerId,
              result: {
                protocol_version: 3,
                prepare_id: preparedPayload.data.prepareId,
                request_id: firstRequestId,
                conversation_id: conversation.id,
                status: "success",
                provider_session_id: "http-e2e-provider-1",
                normalized_events: [
                  {
                    type: "text",
                    payload: {
                      text: "VISIBLE <memory>HTTP relay memory</memory>",
                    },
                  },
                  {
                    type: "result",
                    payload: {
                      status: "success",
                      final_text:
                        "VISIBLE <memory>HTTP relay memory</memory>",
                    },
                  },
                ],
              },
            }),
          },
        );
        assert.equal(callback.status, 200);

        const read = await fetch(
          `${baseUrl}/api/v1/native-live/turns/${preparedPayload.data.prepareId}`,
        );
        assert.equal(read.status, 200);
        const readPayload = await read.json() as {
          data: {
            canonicalStatus: string;
            dispatchStatus: string;
            assistantMessage: {
              id: string;
              blocks: Array<{ text: string | null }>;
            } | null;
          };
        };
        assert.equal(readPayload.data.canonicalStatus, "finalized_success");
        assert.equal(readPayload.data.dispatchStatus, "completed");
        assert.ok(readPayload.data.assistantMessage);
        assert.equal(
          readPayload.data.assistantMessage.blocks[0]?.text,
          "VISIBLE",
        );

        const [provisional] = await database.db
          .select({
            id: runtimeSubjectStates.id,
            text: runtimeSubjectStates.text,
            settlementStatus: runtimeSubjectStates.settlementStatus,
          })
          .from(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.userId, user.id),
              eq(runtimeSubjectStates.kind, "memory"),
            ),
          )
          .limit(1);
        assert.ok(provisional);
        assert.equal(provisional.text, "HTTP relay memory");
        assert.equal(provisional.settlementStatus, "unsettled");

        const secondRequestId = crypto.randomUUID();
        const secondPrepared = await fetch(
          `${baseUrl}/api/v1/native-live/prepare`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              dispatch_target: "claude_code",
              request_id: secondRequestId,
              operation: "send",
              conversation_id: conversation.id,
              expected_head_message_id:
                readPayload.data.assistantMessage.id,
              text: "what was that earlier experience about?",
            }),
          },
        );
        assert.equal(secondPrepared.status, 202);
        const secondPreparedPayload = await secondPrepared.json() as {
          data: {
            prepareId: string;
            semanticPending: boolean;
          };
        };
        assert.equal(secondPreparedPayload.data.semanticPending, true);

        const [settled] = await database.db
          .select({
            id: runtimeSubjectStates.id,
            settlementStatus: runtimeSubjectStates.settlementStatus,
            scopeApplicability: runtimeSubjectStates.scopeApplicability,
          })
          .from(runtimeSubjectStates)
          .where(eq(runtimeSubjectStates.id, provisional.id))
          .limit(1);
        assert.deepEqual(settled, {
          id: provisional.id,
          settlementStatus: "settled",
          scopeApplicability: "global",
        });

        const semanticReserved = await fetch(
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
        assert.equal(semanticReserved.status, 200);
        const semanticPayload = await semanticReserved.json() as {
          data: {
            reservationId: string;
            candidates: Array<{
              stateId: string;
              kind: string;
              text: string;
            }>;
          };
        };
        assert.equal(
          semanticPayload.data.reservationId,
          secondPreparedPayload.data.prepareId,
        );
        assert.equal(
          semanticPayload.data.candidates.some(
            (candidate) => candidate.stateId === provisional.id,
          ),
          true,
        );

        const scores = Object.fromEntries(
          semanticPayload.data.candidates.map((candidate) => [
            candidate.stateId,
            candidate.stateId === provisional.id ? 0.93 : 0.2,
          ]),
        );
        const scored = await fetch(
          `${baseUrl}/internal/native-live-relay/semantic/reservations/${secondPreparedPayload.data.prepareId}/scores`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              listener_instance_id: listenerId,
              scores,
            }),
          },
        );
        assert.equal(scored.status, 200);

        const secondReserved = await fetch(
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
        assert.equal(secondReserved.status, 200);
        const secondReservedPayload = await secondReserved.json() as {
          data: {
            command: { prompt: string };
          };
        };
        assert.equal(
          secondReservedPayload.data.command.prompt.includes(
            "HTTP relay memory",
          ),
          true,
        );

        const manifests = await database.db
          .select({
            items: runtimeContextManifests.items,
          })
          .from(runtimeContextManifests)
          .where(eq(runtimeContextManifests.userId, user.id));
        const selected = manifests
          .flatMap((manifest) => manifest.items)
          .find((item) => {
            const selection = item.selection as
              | { reason?: unknown }
              | undefined;
            return (
              item.sourceId === provisional.id
              && selection?.reason === "breath_semantic_match"
            );
          });
        assert.ok(selected);
      },
    );
  },
);
