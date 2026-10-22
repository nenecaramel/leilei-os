import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
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
    assert.equal(await relayRepository.markFinalizeRejected({
      userId: user.id, listenerInstanceId: listenerB,
      reservationId: conflictReservation.reservationId, code: "FINALIZE_CONFLICT",
    }), "conflict", "a duplicate receipt cannot change the original executor");
    assert.equal(await relayRepository.markFinalizeRejected({
      userId: crypto.randomUUID(), listenerInstanceId: listenerA,
      reservationId: conflictReservation.reservationId, code: "FINALIZE_CONFLICT",
    }), "not_found", "another tenant cannot acknowledge the reservation");
    assert.equal(await relayRepository.ownsSubmitReservation({
      userId: user.id, listenerInstanceId: listenerB,
      reservationId: conflictReservation.reservationId,
    }), false);
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


test("relay rejection constraint upgrades 0105 without changing rows and distinguishes rejection phases", { skip: !enabled }, async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "local Postgres only");
  assert.match(url.pathname, /test|regression|ephemeral/);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.RAILWAY_ENVIRONMENT_NAME, "production");
  const admin = postgres(url.toString(), { max: 1 });
  const name = `relay_rejection_test_${crypto.randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString(), { ssl: false });
  const folder = mkdtempSync(resolve(tmpdir(), "relay-rejection-migrations-"));
  t.after(async () => {
    await database.close();
    await admin.unsafe(`DROP DATABASE "${name}"`);
    await admin.end();
    rmSync(folder, { recursive: true, force: true });
  });
  const migrationsFolder = resolve("drizzle");
  const journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"));
  const previousIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === "0105_retire_claude_photo_album");
  assert.ok(previousIndex >= 0);
  cpSync(migrationsFolder, folder, { recursive: true });
  writeFileSync(resolve(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, previousIndex + 1) }));
  await migrate(database.db, { migrationsFolder: folder });
  // Today's prepare also writes the session owner row (0111). Create that table
  // ahead for the fixture, then drop it so the real 0111 migration recreates it.
  const ownerTable = readFileSync(resolve(migrationsFolder, "0111_native_live_session_owners.sql"), "utf8")
    .split("--> statement-breakpoint").slice(0, 2);
  for (const statement of ownerTable) await database.db.execute(sql.raw(statement));
  const [user] = await database.db.insert(users).values({
    email: `${name}@example.test`, displayName: "Relay rejection constraint",
  }).returning();
  const conversation = await new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(database.db),
  ).createConversation({ userId: user.id, title: "Rejection migration" });
  const coordinator = new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const prepared = await coordinator.prepare(user.id, {
    dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send",
    conversation_id: conversation.id, expected_head_message_id: null, text: "constraint fixture",
  });
  assert.ok(prepared.ok);
  if (!prepared.ok) throw new Error("fixture prepare failed");
  const id = prepared.command.prepare_id;
  const read = () => database.db.select().from(nativeLiveTurnPreparations).where(eq(nativeLiveTurnPreparations.id, id));
  const update = (values: Partial<typeof nativeLiveTurnPreparations.$inferInsert>) => database.db.update(nativeLiveTurnPreparations).set(values).where(eq(nativeLiveTurnPreparations.id, id));
  const owner = crypto.randomUUID(), now = new Date();
  const executing = {
    dispatchStatus: "executing" as const, reservedBy: owner, reservedAt: now,
    reservationExpiresAt: new Date(now.getTime() + 60_000), executionStartedAt: now,
    dispatchErrorCode: null, deliveryUnknownAt: null,
  };
  await update(executing);
  const before = await read();
  await database.db.execute(sql`DROP TABLE native_live_session_owners`);
  await migrate(database.db, { migrationsFolder });
  await migrate(database.db, { migrationsFolder });
  assert.deepEqual(await read(), before, "upgrading and retrying migrations preserves the original execution row");
  const rejected = {
    ...executing, dispatchStatus: "rejected" as const,
    reservationExpiresAt: null, dispatchErrorCode: "FINALIZE_CONFLICT",
  };
  const relay = new DrizzleNativeLiveBackendRelayRepository(database.db);
  for (const phase of ["executing", "delivery_unknown"] as const) {
    const unknownAt = phase === "delivery_unknown" ? now : null;
    await update({ ...executing, dispatchStatus: phase, deliveryUnknownAt: unknownAt });
    const receipt = { userId: user.id, listenerInstanceId: owner, reservationId: id, code: "FINALIZE_CONFLICT" as const };
    assert.equal(await relay.markFinalizeRejected(receipt), "applied");
    assert.equal(await relay.markFinalizeRejected(receipt), "idempotent");
    // Recreate the repository to model a lost response followed by a process restart.
    assert.equal(await new DrizzleNativeLiveBackendRelayRepository(database.db).markFinalizeRejected(receipt), "idempotent");
    const [stored] = await read();
    assert.equal(stored.reservedBy, owner);
    assert.deepEqual(stored.reservedAt, now);
    assert.deepEqual(stored.executionStartedAt, now);
    assert.deepEqual(stored.deliveryUnknownAt, unknownAt);
    assert.equal(stored.reservationExpiresAt, null);
  }
  const preExecution = {
    dispatchStatus: "rejected" as const, reservedBy: null, reservedAt: null,
    reservationExpiresAt: null, executionStartedAt: null, deliveryUnknownAt: null,
    dispatchErrorCode: "SUPERSEDED_BY_NEWER_TURN",
  };
  await update(preExecution);
  await update({ ...preExecution, dispatchErrorCode: null }); // Existing legacy rejection rows remain valid.
  await update(rejected);
  const illegal = [
    { ...preExecution, dispatchErrorCode: "FINALIZE_CONFLICT" },
    { ...preExecution, reservedBy: owner },
    { ...rejected, reservedBy: null },
    { ...rejected, reservedAt: null },
    { ...rejected, executionStartedAt: null },
    { ...rejected, reservationExpiresAt: now },
    { ...rejected, dispatchErrorCode: "OTHER_FAILURE" },
    { ...rejected, dispatchErrorCode: null },
    { ...executing, reservedBy: null },
    { ...executing, executionStartedAt: null },
    { ...executing, dispatchStatus: "reserved" as const },
    { ...executing, dispatchStatus: "pending" as const },
  ];
  for (const values of illegal) {
    await assert.rejects(() => update(values), (error: unknown) => {
      const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
      assert.equal(cause?.code, "23514");
      assert.equal(cause?.constraint_name, "native_live_turn_preparations_dispatch_reservation_consistency");
      return true;
    }, JSON.stringify(values));
  }
});

test('relay supplies failed input receipts only for the exact canonical resume binding', {skip: !enabled}, async t => {
  const database=createDatabase(process.env.DATABASE_URL!,{ssl:false});
  const [user]=await database.db.insert(users).values({email:`failed-native-tail-${crypto.randomUUID()}@example.com`,displayName:'Failed native tail'}).returning();
  t.after(async()=>{try{await database.db.delete(nativeLiveRuntimeListenerLeases).where(eq(nativeLiveRuntimeListenerLeases.userId,user.id));await database.db.delete(conversations).where(eq(conversations.userId,user.id));await database.db.delete(users).where(eq(users.id,user.id));}finally{await database.close();}});
  const service=new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(database.db));
  const conversation=await service.createConversation({userId:user.id,title:'Synthetic failed input binding'});
  const coordinator=new NativeLiveBackendTurnCoordinator(new DrizzleNativeLiveBackendTurnPort(database.db));
  const repo=new DrizzleNativeLiveBackendRelayRepository(database.db);
  const relay=new NativeLiveBackendRelayService(repo,coordinator);
  const session=crypto.randomUUID(), checkpoint=crypto.randomUUID(), listener=crypto.randomUUID();
  const binding={runtimeMode:'resume' as const,parentProviderSessionId:session,parentProviderCheckpointId:checkpoint,expectedWorkingDirectory:'/synthetic/native-tail'};
  async function prepare(){const result=await coordinator.prepare(user.id,{dispatch_target:'claude_code',request_id:crypto.randomUUID(),operation:'send',conversation_id:conversation.id,expected_head_message_id:null,text:'synthetic'});assert.equal(result.ok,true);if(!result.ok)throw Error('prepare failed');return result.command;}
  const ids:string[]=[];
  for(const mismatch of [{}, {parentProviderSessionId:crypto.randomUUID()}, {parentProviderCheckpointId:crypto.randomUUID()}, {expectedWorkingDirectory:'/different'}, {runtimeMode:'fork' as const}]){
    const command=await prepare();ids.push(command.canonical_user_message_id!);
    const now=new Date();await database.db.update(nativeLiveTurnPreparations).set({...binding,...mismatch,status:'finalized_failure',dispatchStatus:'completed',failureCode:'PROVIDER_SESSION_CONFLICT',resultHash:'a'.repeat(64),finalizedAt:now,reservedBy:listener,reservedAt:now,reservationExpiresAt:now,executionStartedAt:now}).where(eq(nativeLiveTurnPreparations.id,command.prepare_id));
  }
  // A failed in-place Retry resent its user message under the preparation id:
  // the canonical id was already in the transcript, so that is its native input.
  const failedRetry=await prepare();
  {const now=new Date();await database.db.update(nativeLiveTurnPreparations).set({...binding,operation:'retry',replacementTargetUserMessageId:failedRetry.canonical_user_message_id,status:'finalized_failure',dispatchStatus:'completed',failureCode:'PROVIDER_SESSION_CONFLICT',resultHash:'a'.repeat(64),finalizedAt:now,reservedBy:listener,reservedAt:now,reservationExpiresAt:now,executionStartedAt:now}).where(eq(nativeLiveTurnPreparations.id,failedRetry.prepare_id));}
  // An unresolved turn at the same position is not proof of a failed input.
  const unresolved=await prepare();await database.db.update(nativeLiveTurnPreparations).set(binding).where(eq(nativeLiveTurnPreparations.id,unresolved.prepare_id));
  const current=await prepare();await database.db.update(nativeLiveTurnPreparations).set(binding).where(eq(nativeLiveTurnPreparations.id,current.prepare_id));
  assert.equal(await relay.renewLease({userId:user.id,listenerInstanceId:listener,dispatchTarget:'claude_code'}),'acquired');
  await relay.enqueuePreparation({userId:user.id,prepareId:current.prepare_id});
  const reserved=await relay.reserveNext({userId:user.id,listenerInstanceId:listener,dispatchTarget:'claude_code'});
  assert.ok(reserved);assert.equal(reserved.reservationId,current.prepare_id);
  assert.deepEqual(reserved.command.failed_user_message_uuids,[failedRetry.prepare_id,ids[0]]);
  assert.equal(reserved.command.parent_provider_session_id,session);assert.equal(reserved.command.parent_provider_checkpoint_id,checkpoint);
});
