import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  conversationMessages,
  nativeLiveRuntimeListenerLeases,
  nativeLiveTurnPreparations,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";

const enabled = process.env.RUN_NATIVE_LIVE_RELAY_DATABASE_TEST === "1";

test(
  "native live relay DB queue leases, reserves, finalizes, and safely requeues pre-execution failures",
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
            .where(
              eq(nativeLiveRuntimeListenerLeases.userId, cleanupUserId),
            );
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
        email: `native-live-relay-${suffix}@example.com`,
        displayName: "Native Live Relay",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId: user.id,
      title: "Relay integration",
    });

    const coordinator = new NativeLiveBackendTurnCoordinator(
      new DrizzleNativeLiveBackendTurnPort(database.db),
    );
    const relayRepository =
      new DrizzleNativeLiveBackendRelayRepository(database.db);
    const relay = new NativeLiveBackendRelayService(
      relayRepository,
      coordinator,
    );

    const listenerA = crypto.randomUUID();
    const listenerB = crypto.randomUUID();

    assert.equal(
      await relay.renewLease({
        userId: user.id,
        listenerInstanceId: listenerA,
        dispatchTarget: "claude_code",
      }),
      "acquired",
    );
    assert.equal(
      await relay.renewLease({
        userId: user.id,
        listenerInstanceId: listenerB,
        dispatchTarget: "claude_code",
      }),
      "busy",
    );

    const firstRequestId = crypto.randomUUID();
    const first = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("expected first prepare success");

    const persistedAttachment = {
      attachment_id: crypto.randomUUID(),
      filename: "relay-image.png",
      mime_type: "image/png",
      size_bytes: 4,
      sha256: "a".repeat(64),
      kind: "image" as const,
    };
    await database.db
      .update(nativeLiveTurnPreparations)
      .set({
        attachments: [persistedAttachment],
      })
      .where(
        eq(
          nativeLiveTurnPreparations.id,
          first.command.prepare_id,
        ),
      );

    assert.equal(
      await relay.reserveNext({
        userId: user.id,
        listenerInstanceId: listenerA,
        dispatchTarget: "claude_code",
      }),
      null,
    );
    await relay.enqueuePreparation({
      userId: user.id,
      prepareId: first.command.prepare_id,
    });

    const firstReservation = await relay.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerA,
      dispatchTarget: "claude_code",
    });
    assert.ok(firstReservation);
    assert.equal(
      firstReservation.reservationId,
      first.command.prepare_id,
    );
    assert.deepEqual(firstReservation.command, {
      ...first.command,
      attachments: [persistedAttachment],
    });

    await relay.markExecutionStarted({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: firstReservation.reservationId,
    });

    const finalizedFailure = await relay.submitResult({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: firstReservation.reservationId,
      result: {
        protocol_version: 4,
        prepare_id: first.command.prepare_id,
        request_id: firstRequestId,
        conversation_id: conversation.id,
        status: "failure",
        error_code: "CLAUDE_PROCESS_FAILED",
      },
    });
    assert.equal(finalizedFailure.ok, false);
    if (finalizedFailure.ok) throw new Error("expected runtime failure");
    assert.equal(finalizedFailure.code, "CLAUDE_PROCESS_FAILED");

    const [firstStored] = await database.db
      .select({
        status: nativeLiveTurnPreparations.status,
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
      })
      .from(nativeLiveTurnPreparations)
      .where(eq(nativeLiveTurnPreparations.id, first.command.prepare_id));
    assert.deepEqual(firstStored, {
      status: "finalized_failure",
      dispatchStatus: "completed",
    });

    const secondRequestId = crypto.randomUUID();
    const second = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: secondRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "retryable start",
    });
    assert.equal(second.ok, true);
    if (!second.ok) throw new Error("expected second prepare success");
    await relay.enqueuePreparation({
      userId: user.id,
      prepareId: second.command.prepare_id,
    });

    const secondReservation = await relay.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerA,
      dispatchTarget: "claude_code",
    });
    assert.ok(secondReservation);
    assert.equal(
      secondReservation.reservationId,
      second.command.prepare_id,
    );

    await relay.rejectReservation({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: secondReservation.reservationId,
      code: "EXECUTION_START_FAILED",
    });

    const reReserved = await relay.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerA,
      dispatchTarget: "claude_code",
    });
    assert.ok(reReserved);
    assert.equal(reReserved.reservationId, secondReservation.reservationId);
    assert.deepEqual(reReserved.command, secondReservation.command);

    await relay.markExecutionStarted({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: reReserved.reservationId,
    });
    await relay.markResultDeliveryUnknown({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: reReserved.reservationId,
    });
    await database.db
      .update(nativeLiveTurnPreparations)
      .set({
        deliveryUnknownAt: new Date(Date.now() - 86_400_000),
      })
      .where(
        eq(
          nativeLiveTurnPreparations.id,
          reReserved.reservationId,
        ),
      );

    assert.equal(
      await relay.renewLease({
        userId: user.id,
        listenerInstanceId: listenerA,
        dispatchTarget: "claude_code",
      }),
      "renewed",
    );

    const [recoveredUnknown] = await database.db
      .select({
        status: nativeLiveTurnPreparations.status,
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
        dispatchErrorCode:
          nativeLiveTurnPreparations.dispatchErrorCode,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        eq(
          nativeLiveTurnPreparations.id,
          reReserved.reservationId,
        ),
      );

    assert.deepEqual(recoveredUnknown, {
      status: "prepared",
      dispatchStatus: "delivery_unknown",
      reservedBy: listenerA,
      dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN",
    });
    // Execution ambiguity must survive an arbitrarily long outage, preserving the original owner.
    assert.equal(await relay.reserveNext({ userId: user.id, listenerInstanceId: listenerA, dispatchTarget: "claude_code" }), null);
    const [expiredUnknown] = await database.db.select({
      dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
      reservedBy: nativeLiveTurnPreparations.reservedBy,
      dispatchErrorCode: nativeLiveTurnPreparations.dispatchErrorCode,
    }).from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, reReserved.reservationId));
    assert.deepEqual(expiredUnknown, { dispatchStatus: "delivery_unknown", reservedBy: listenerA, dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN" });
    const result = {
      protocol_version: 4 as const,
      prepare_id: second.command.prepare_id,
      request_id: secondRequestId,
      conversation_id: conversation.id,
      status: "success" as const,
      provider_session_id: "durable-provider",
      provider_checkpoint_id: crypto.randomUUID(),
      normalized_events: [{ type: "result" as const, payload: { status: "success", final_text: "recovered" } }],
    };
    const submit = () => relay.submitResult({ userId: user.id, listenerInstanceId: listenerA, reservationId: reReserved.reservationId, result });
    // Server committed, but the first HTTP response never reached the Mac.
    const firstCommit = await submit();
    assert.equal(firstCommit.ok, true);
    const retry = await submit();
    assert.equal(retry.ok, true);
    if (!firstCommit.ok || !retry.ok || !("assistantMessageId" in firstCommit) || !("assistantMessageId" in retry)) throw new Error("expected canonical completion");
    assert.equal(retry.assistantMessageId, firstCommit.assistantMessageId);
    const messages = await database.db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversation.id));
    assert.equal(messages.filter((row) => row.role === "assistant").length, 1);
    const [head] = await database.db.select({ id: conversations.currentHeadMessageId }).from(conversations).where(eq(conversations.id, conversation.id));
    assert.equal(head.id, firstCommit.assistantMessageId);

    const conflictRequestId = crypto.randomUUID();
    const conflict = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: conflictRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: firstCommit.assistantMessageId,
      text: "terminal conflict fixture",
    });
    assert.equal(conflict.ok, true);
    if (!conflict.ok) throw new Error("expected conflict fixture prepare success");
    await relay.enqueuePreparation({
      userId: user.id,
      prepareId: conflict.command.prepare_id,
    });
    const conflictReservation = await relay.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerA,
      dispatchTarget: "claude_code",
    });
    assert.ok(conflictReservation);
    await relay.markExecutionStarted({
      userId: user.id,
      listenerInstanceId: listenerA,
      reservationId: conflictReservation.reservationId,
    });
    assert.equal(
      await relayRepository.markFinalizeRejected({
        userId: user.id,
        listenerInstanceId: listenerA,
        reservationId: conflictReservation.reservationId,
        code: "FINALIZE_CONFLICT",
      }),
      "applied",
    );
    assert.equal(
      await relayRepository.markFinalizeRejected({
        userId: user.id,
        listenerInstanceId: listenerA,
        reservationId: conflictReservation.reservationId,
        code: "FINALIZE_CONFLICT",
      }),
      "idempotent",
    );
    assert.equal(
      await relayRepository.ownsSubmitReservation({
        userId: user.id,
        listenerInstanceId: listenerA,
        reservationId: conflictReservation.reservationId,
      }),
      true,
    );
    const [conflictStored] = await database.db.select({
      dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
      reservedBy: nativeLiveTurnPreparations.reservedBy,
      dispatchErrorCode: nativeLiveTurnPreparations.dispatchErrorCode,
    }).from(nativeLiveTurnPreparations).where(
      eq(nativeLiveTurnPreparations.id, conflictReservation.reservationId),
    );
    assert.deepEqual(conflictStored, {
      dispatchStatus: "rejected",
      reservedBy: listenerA,
      dispatchErrorCode: "FINALIZE_CONFLICT",
    });

  },
);
