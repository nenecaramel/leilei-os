import { readFileSync } from "node:fs";
import postgres from "postgres";
import assert from "node:assert/strict";
import test from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveBackgroundModelJobs,
  productCreateIdempotency,
  runtimeSubjectStates,
  runtimeContextManifests,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleMindProductRepository,
} from "../src/domains/runtime/mind-product-repository.js";
import {
  MindProductService,
  MindProductServiceError,
} from "../src/domains/runtime/mind-product-service.js";

import { DrizzleProactivityWakeOpportunitySource } from "../src/domains/runtime/proactivity-wake-opportunity.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state-runtime-repository.js";
import { createDefaultBackendMindRuntime } from "../src/domains/runtime/default-backend-mind-runtime.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/native-live-backend-turn-repository.js";

const enabled =
  process.env.RUN_RUNTIME_MIND_PRODUCT_DATABASE_TEST === "1";

test(
  "Mind product manual CRUD, dependency repair, and message write projection are durable",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(nativeLiveBackgroundModelJobs)
            .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(productCreateIdempotency)
            .where(eq(productCreateIdempotency.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `mind-product-${crypto.randomUUID()}@example.com`,
        displayName: "Mind Product DB Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const repository = new DrizzleMindProductRepository(database.db);
    const service = new MindProductService(repository, "G");

    const manualCreateKey = "mind-manual-db-create-0001";
    const manual = await service.createManual({
      userId,
      kind: "memory",
      text: "historical manual memory",
      occurredAt: "2025-03-04T05:06:07.000Z",
      note: "typed by hand",
      idempotencyKey: manualCreateKey,
    });
    const manualReplay = await service.createManual({
      userId,
      kind: "memory",
      text: "historical manual memory",
      occurredAt: "2025-03-04T05:06:07.000Z",
      note: "typed by hand",
      idempotencyKey: manualCreateKey,
    });
    assert.deepEqual(manualReplay, manual);
    await assert.rejects(
      service.createManual({
        userId,
        kind: "memory",
        text: "different manual memory",
        occurredAt: "2025-03-04T05:06:07.000Z",
        note: "typed by hand",
        idempotencyKey: manualCreateKey,
      }),
      (error: unknown) =>
        error instanceof MindProductServiceError
        && error.code === "IDEMPOTENCY_CONFLICT",
    );
    assert.equal(manual.source, "manual");
    assert.equal(manual.authority, "user_asserted");

    const listed = await service.list({
      userId,
      kind: "memory",
      limit: 20,
    });
    assert.equal(
      listed.items.some((item) => item.id === manual.id),
      true,
    );
    assert.equal(
      (await service.get({ userId, stateId: manual.id })).id,
      manual.id,
    );

    const sharedId = crypto.randomUUID();
    const exclusiveId = crypto.randomUUID();
    await database.db.insert(runtimeSubjectStates).values([
      {
        id: sharedId,
        userId,
        subjectId: "G",
        kind: "thought",
        text: "shared dependent thought",
        payload: { thought_v2: { status: "active" } },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "runtime", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [
              { kind: "persistent_state", id: manual.id },
              { kind: "ledger_event", id: "surviving-source" },
            ],
            causedBy: manual.id,
            derivedFrom: [manual.id],
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "test",
            processVersion: "test",
          },
        },
      },
      {
        id: exclusiveId,
        userId,
        subjectId: "G",
        kind: "thought",
        text: "exclusive dependent thought",
        payload: null,
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "runtime", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [{ kind: "persistent_state", id: manual.id }],
            causedBy: manual.id,
            derivedFrom: [manual.id],
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "test",
            processVersion: "test",
          },
        },
      },
    ]);

    const deletion = await service.delete({
      userId,
      stateId: manual.id,
    });
    assert.equal(deletion.deletedStateCount, 2);

    await assert.rejects(
      service.get({ userId, stateId: manual.id }),
      /MIND_NOT_FOUND/,
    );
    await assert.rejects(
      service.get({ userId, stateId: exclusiveId }),
      /MIND_NOT_FOUND/,
    );

    const [shared] = await database.db
      .select({
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, sharedId))
      .limit(1);
    assert.ok(shared);
    // Only provenance referenced the deleted state, so the thought itself
    // survives with its own lifecycle intact.
    assert.deepEqual(shared.payload, { thought_v2: { status: "active" } });
    const provenance = (
      shared.envelope.provenance as Record<string, unknown>
    );
    assert.deepEqual(provenance.sources, [
      { kind: "ledger_event", id: "surviving-source" },
    ]);
    assert.equal(provenance.causedBy, null);
    assert.deepEqual(provenance.derivedFrom, []);

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Mind writes",
    });
    const userMessage = await conversationService.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "hello" }],
    });
    const assistant = await conversationService.completeAssistantTurn({
      userId,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "mind-product-test-session",
      },
    });

    await database.db.insert(runtimeSubjectStates).values({
      id: crypto.randomUUID(),
      userId,
      subjectId: "G",
      kind: "feel",
      text: "authored feel",
      payload: null,
      scopeApplicability: "path",
      scopeConversationId: conversation.id,
      scopePathHeadMessageId: assistant.message.id,
      settlementStatus: "unsettled",
      pathStatus: "current",
      validityStatus: "valid",
      envelope: {
        semanticActor: { kind: "subject", id: "G" },
        producer: { kind: "model", id: "claude-code" },
        committer: { kind: "runtime", id: "leileios-runtime" },
        authority: "subject_authorized",
        scope: {
          userId,
          subjectId: "G",
          applicability: "path",
          conversationId: conversation.id,
          pathHeadMessageId: assistant.message.id,
          visibility: "subject_private",
          sensitivity: "normal",
          audience: ["G"],
        },
        status: {
          generationStatus: "committed",
          presentationStatus: "presented",
          pathStatus: "current",
          settlementStatus: "unsettled",
          validityStatus: "valid",
        },
        provenance: {
          sources: [{
            kind: "message",
            id: assistant.message.id,
          }],
          causedBy: assistant.message.id,
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "test",
          processVersion: "test",
        },
      },
    });

    assert.deepEqual(
      await service.readMessageWrites({
        userId,
        messageId: assistant.message.id,
      }),
      {
        messageId: assistant.message.id,
        total: 1,
        kinds: [{ kind: "feel", count: 1 }],
      },
    );
  },
);


test("live Mind excludes legacy storage kinds without changing stored rows", { skip: !enabled }, async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  // Reproduce pre-0092 rows in a private test schema. Never relax the checked-in
  // constraint in public, even in this disposable DB.
  const databaseName = new URL(databaseUrl).pathname;
  assert.match(databaseName, /test|ci|regression|ephemeral|scratch/i);
  assert.notEqual(process.env.NODE_ENV, "production");
  assert.notEqual(process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase(), "production");
  const schemaName = `legacy_mind_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(databaseUrl, { ssl: false });
  let fixtureUserId: string | null = null;
  let fixtureDatabase: ReturnType<typeof createDatabase> | null = null;
  t.after(async () => {
    try {
      await fixtureDatabase?.close();
      await admin.db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
      if (fixtureUserId) {
        await admin.db.delete(runtimeContextManifests).where(eq(runtimeContextManifests.userId, fixtureUserId));
        await admin.db.delete(conversations).where(eq(conversations.userId, fixtureUserId));
        await admin.db.delete(users).where(eq(users.id, fixtureUserId));
      }
    } finally { await admin.close(); }
  });
  await admin.db.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
  await admin.db.execute(sql.raw(`CREATE TABLE "${schemaName}".runtime_subject_states (LIKE public.runtime_subject_states INCLUDING ALL)`));
  await admin.db.execute(sql.raw(`ALTER TABLE "${schemaName}".runtime_subject_states DROP CONSTRAINT runtime_subject_states_kind_allowed`));
  const preContraction = readFileSync(new URL("../drizzle/0047_runtime_mind_v1.sql", import.meta.url), "utf8")
    .split("\n").find((line) => line.includes('CONSTRAINT "runtime_subject_states_kind_allowed"'));
  assert.ok(preContraction);
  await admin.db.execute(sql.raw(`ALTER TABLE "${schemaName}".runtime_subject_states ADD ${preContraction.trim().replace(/,$/, "")}`));
  const database = createDatabase(databaseUrl, {
    ssl: false,
    createClient: (url) => postgres(url, {
      max: 1, ssl: false, prepare: false,
      connection: { search_path: `"${schemaName}",public` },
    }),
  });
  fixtureDatabase = database;
  const { db } = database;
  const [user] = await db.insert(users).values({
    email: `legacy-mind-${crypto.randomUUID()}@example.com`,
    displayName: "Legacy Mind Reader",
  }).returning({ id: users.id });
  assert.ok(user);
  const userId = user.id;
  fixtureUserId = userId;
  const conversationService = new NativeLiveConversationService(new DrizzleNativeLiveConversationRepository(db));
  const conversation = await conversationService.createConversation({ userId, title: "Legacy Mind" });
  const message = await conversationService.appendUserMessage({
    userId, conversationId: conversation.id, parentMessageId: null,
    blocks: [{ kind: "text", text: "hello" }],
  });
  const assistant = await conversationService.completeAssistantTurn({
    userId, conversationId: conversation.id, parentMessageId: message.id,
    blocks: [{ kind: "text", text: "reply" }],
    checkpoint: { provider: "claude_code", providerSessionId: "legacy-reader-test" },
  });
  const records = [];
  for (const kind of ["feel", "memory", "thought", "drive", "curiosity", "topic"]) {
    const id = crypto.randomUUID();
    // Whole-second timestamps keep this fixture independent of the existing
    // cursor's millisecond precision, with legacy rows newest in the list.
    const storedAt = new Date(Date.UTC(2026, 8, 30, 0, 0, records.length)).toISOString();
    const envelope = {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "test" },
      authority: "subject_authorized",
      scope: { userId, subjectId: "G", applicability: "global", conversationId: null,
        pathHeadMessageId: null, visibility: "subject_private", sensitivity: "normal", audience: ["G"] },
      status: { generationStatus: "committed", presentationStatus: "presented",
        pathStatus: "current", settlementStatus: "settled", validityStatus: "valid" },
      provenance: { sources: [{ kind: "message", id: assistant.message.id }],
        causedBy: assistant.message.id, derivedFrom: [] },
      versions: { schemaVersion: 1, ruleVersion: "test", processVersion: "test" },
    };
    // Raw SQL deliberately bypasses the three-kind application type to model
    // rows stored before the real CHECK contraction migration.
    await db.execute(sql`
      INSERT INTO runtime_subject_states
        (id, user_id, subject_id, kind, text, payload, scope_applicability,
         settlement_status, path_status, validity_status, envelope, created_at, updated_at)
      VALUES (${id}::uuid, ${userId}::uuid, 'G', ${kind}, ${`reader-${kind}`},
        ${JSON.stringify(kind === "thought" ? { thought_v2: { status: "active" } } : {})}::jsonb,
        'global', 'settled', 'current', 'valid', ${JSON.stringify(envelope)}::jsonb,
        ${storedAt}::timestamptz, ${storedAt}::timestamptz)
    `);
    records.push({ id, kind, text: `reader-${kind}` });
  }
  // Apply the authoritative migration unchanged: historical rows survive its
  // NOT VALID CHECK, while future retired writes must be rejected.
  const contraction = readFileSync(new URL("../drizzle/0092_runtime_mind_three_kind_check.sql", import.meta.url), "utf8");
  for (const statement of contraction.split("--> statement-breakpoint")) {
    await db.execute(sql.raw(statement));
  }
  await t.test("post-contraction retired writes are rejected by the actual CHECK", async () => {
    for (const kind of ["drive", "curiosity", "topic", "dream", "bedrock"]) {
      await assert.rejects(db.execute(sql`
        INSERT INTO runtime_subject_states
          (id, user_id, subject_id, kind, text, scope_applicability, settlement_status, path_status, validity_status, envelope)
        VALUES (${crypto.randomUUID()}::uuid, ${userId}::uuid, 'G', ${kind}, 'rejected new row', 'global', 'settled', 'current', 'valid', '{}'::jsonb)
      `), (error: unknown) => {
        const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
        return cause?.code === "23514" && cause.constraint_name === "runtime_subject_states_kind_allowed";
      });
    }
  });
  const current = records.slice(0, 3);
  const legacy = records.slice(3);
  const repository = new DrizzleMindProductRepository(db);
  const service = new MindProductService(repository, "G");

  await t.test("foreground runtime reads only the three current kinds", async () => {
    const rows = await new DrizzleSubjectStateRuntimePort(db).list({ userId, subjectId: "G", conversationId: conversation.id });
    assert.deepEqual(rows.map(({ id }) => id).sort(), current.map(({ id }) => id).sort());
  });
  await t.test("existing live background capsule excludes legacy kinds", async () => {
    const source = new DrizzleProactivityWakeOpportunitySource(db, { minIdleMs: 0, cooldownMs: 0 });
    // Exercise the real model-input builder against Postgres; opportunity
    // scheduling and its separate activity-timestamp handling are out of scope.
    const capsuleText = await source["buildCapsule"]({
      userId, subjectId: "G", conversationId: conversation.id, headMessageId: assistant.message.id,
    });
    const capsule = JSON.parse(capsuleText);
    // The existing capsule eligibility rule excludes Memory/Feel fixtures
    // without lifecycle_v1. The active Thought must still reach the model.
    assert.deepEqual(
      capsule.subject_state.map((row: { state_id: string }) => row.state_id),
      [current[2]!.id],
    );
    for (const row of legacy) assert.equal(capsuleText.includes(row.text), false);
  });
  await t.test("live Context prepares without errors or legacy exposure", async () => {
    const coordinator = new NativeLiveBackendTurnCoordinator(
      new DrizzleNativeLiveBackendTurnPort(db), undefined, createDefaultBackendMindRuntime(db),
    );
    const prepared = await coordinator.prepare(userId, {
      dispatch_target: "claude_code", request_id: crypto.randomUUID(), operation: "send",
      conversation_id: conversation.id, expected_head_message_id: assistant.message.id,
      text: "reader-memory reader-feel",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("Context prepare failed");
    assert.equal(prepared.command.prompt.includes("reader-thought"), true);
    for (const row of legacy) {
      assert.equal(prepared.command.prompt.includes(row.text), false);
      assert.equal(prepared.command.prompt.includes(row.id), false);
    }
    const [manifest] = await db.select({ items: runtimeContextManifests.items })
      .from(runtimeContextManifests).where(eq(runtimeContextManifests.id, prepared.command.prepare_id));
    assert.ok(manifest);
    for (const row of legacy) assert.equal(JSON.stringify(manifest.items).includes(row.id), false);
  });
  await t.test("Mind list pagination excludes legacy rows", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.list({ userId, limit: 1, cursor });
      ids.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
      assert.ok(ids.length <= current.length, "legacy rows must not occupy a page");
    } while (cursor);
    assert.deepEqual(ids.sort(), current.map(({ id }) => id).sort());
  });
  await t.test("Mind detail treats legacy IDs as not found", async () => {
    for (const row of legacy) {
      assert.equal(await repository.get({ userId, subjectId: "G", stateId: row.id }), null);
      await assert.rejects(service.get({ userId, stateId: row.id }),
        (error: unknown) => error instanceof MindProductServiceError && error.code === "MIND_NOT_FOUND");
    }
    for (const row of current) assert.equal((await service.get({ userId, stateId: row.id })).kind, row.kind);
  });
  await t.test("message projection excludes legacy rows, including legacy-only writes", async () => {
    const writes = await repository.readMessageWrites({ userId, subjectId: "G", messageId: assistant.message.id });
    assert.deepEqual(writes?.map(({ kind }) => kind).sort(), ["feel", "memory", "thought"]);
    assert.equal((await service.readMessageWrites({ userId, messageId: assistant.message.id })).total, 3);
    await db.delete(runtimeSubjectStates).where(inArray(runtimeSubjectStates.id, current.map(({ id }) => id)));
    assert.deepEqual(await repository.readMessageWrites({ userId, subjectId: "G", messageId: assistant.message.id }), []);
    assert.deepEqual(await service.readMessageWrites({ userId, messageId: assistant.message.id }), {
      messageId: assistant.message.id, total: 0, kinds: [],
    });
  });
  const stored = await db.select({ id: runtimeSubjectStates.id }).from(runtimeSubjectStates)
    .where(eq(runtimeSubjectStates.userId, userId));
  assert.deepEqual(stored.map(({ id }) => id).sort(), legacy.map(({ id }) => id).sort());
});
