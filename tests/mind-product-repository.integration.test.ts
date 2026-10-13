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
} from "../src/domains/runtime/mind/mind-product-repository.js";
import {
  MindProductService,
  MindProductServiceError,
} from "../src/domains/runtime/mind/mind-product-service.js";

import { DrizzleProactivityWakeOpportunitySource } from "../src/domains/runtime/proactivity/proactivity-wake-opportunity.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { createDefaultBackendMindRuntime } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { NativeLiveBackendTurnCoordinator } from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import { DrizzleNativeLiveBackendTurnPort } from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";

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
        kind: "memory",
        text: "shared dependent memory",
        payload: { preserved_metadata: { source: "shared" } },
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
        kind: "memory",
        text: "exclusive dependent memory",
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
    // Only provenance referenced the deleted state, so the memory itself
    // survives with its own lifecycle intact.
    assert.deepEqual(shared.payload, { preserved_metadata: { source: "shared" } });
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
      kind: "memory",
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
        kinds: [{ kind: "memory", count: 1 }],
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
    // Raw SQL deliberately bypasses the memory-only application type to model
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
  const current = records.filter(row => row.kind === "memory");
  const legacy = records.filter(row => row.kind !== "memory");
  const repository = new DrizzleMindProductRepository(db);
  const service = new MindProductService(repository, "G");

  await t.test("foreground runtime reads only memory", async () => {
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
    // Memories without lifecycle_v1 remain ineligible; legacy kinds never reach the model.
    assert.deepEqual(
      capsule.subject_state.map((row: { state_id: string }) => row.state_id),
      [],
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
      text: "reader-memory",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("Context prepare failed");
    assert.equal(prepared.command.prompt.includes("reader-thought"), false);
    for (const row of legacy) {
      assert.equal(prepared.command.prompt.includes(row.text), false);
      assert.equal(prepared.command.prompt.includes(row.id), false);
    }
    // Native Claude delegates recall to installed Hooks. Preparing a turn must not
    // create a backend recall manifest or inject legacy states itself.
    assert.equal(prepared.command.prompt, "reader-memory");
    const manifests = await db.select({ items: runtimeContextManifests.items })
      .from(runtimeContextManifests).where(eq(runtimeContextManifests.userId, userId));
    assert.deepEqual(manifests, [], "Hook-only preparation must not create a backend recall receipt");
  });
  await t.test("Mind list pagination excludes legacy rows", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.list({ userId, limit: 1, cursor });
      assert.equal(page.totalCount, current.length, "count excludes legacy states on every page");
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
    assert.deepEqual(writes?.map(({ kind }) => kind).sort(), ["memory"]);
    assert.equal((await service.readMessageWrites({ userId, messageId: assistant.message.id } )).total, 1);
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

test("undated Mind list filters before pagination without changing either existing sort", {skip: !enabled}, async t => {
  const url = process.env.DATABASE_URL;
  assert.ok(url && /test|scratch|regression/.test(new URL(url).pathname));
  const database = createDatabase(url, {ssl:false});
  const [user] = await database.db.insert(users).values({email:`undated-list-${crypto.randomUUID()}@example.com`,displayName:"Undated list test"}).returning({id:users.id});
  assert.ok(user);
  t.after(async () => {
    await database.db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId,user.id));
    await database.db.delete(productCreateIdempotency).where(eq(productCreateIdempotency.userId,user.id));
    await database.db.delete(users).where(eq(users.id,user.id));
    await database.close();
  });
  const service = new MindProductService(new DrizzleMindProductRepository(database.db),"G");
  const expected: string[] = [];
  let datedId: string | null = null;
  for (let index=0;index<4;index++) {
    const item = await service.createManual({userId:user.id,kind:"memory",text:`list fixture ${index}`,idempotencyKey:crypto.randomUUID(),occurredAt:index===2 ? "2026-10-09T00:00:00Z" : null});
    if(index!==2) expected.push(item.id);
    else datedId = item.id;
  }
  for(const sort of ["updated_desc","occurred_desc"] as const) {
    const ids: string[] = [];
    let cursor: string|null = null;
    do {
      const page = await service.list({userId:user.id,kind:"memory",sort,undated:true,limit:1,cursor});
      assert.equal(page.items.length,1);
      assert.equal(page.totalCount,4,"Undated Only must retain the full Memory count");
      assert.equal(page.items[0]!.occurredAt,null);
      ids.push(page.items[0]!.id);
      cursor = page.nextCursor;
    } while(cursor);
    assert.deepEqual([...ids].sort(),[...expected].sort());
    assert.equal(new Set(ids).size,3);
    const unfiltered = await service.list({userId:user.id,kind:"memory",sort});
    assert.equal(unfiltered.totalCount,4);
    assert.deepEqual(ids,unfiltered.items.filter(item=>item.occurredAt===null).map(item=>item.id));
  }
  assert.ok(datedId);
  await service.delete({userId:user.id,stateId:datedId});
  const afterDelete = await service.list({userId:user.id,kind:"memory",undated:true,limit:1});
  assert.equal(afterDelete.totalCount,3,"count reflects deletion despite page limit");
});

test("Memory header count matches visibility and isolates users and subjects", { skip: !enabled }, async (t) => {
  const url = process.env.DATABASE_URL;
  assert.ok(url && /test|scratch|regression/.test(new URL(url).pathname));
  const database = createDatabase(url, { ssl: false });
  const createdUsers: string[] = [];
  t.after(async () => {
    try {
      for (const id of createdUsers) {
        await database.db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, id));
        await database.db.delete(productCreateIdempotency).where(eq(productCreateIdempotency.userId, id));
        await database.db.delete(users).where(eq(users.id, id));
      }
    } finally { await database.close(); }
  });
  for (let index = 0; index < 2; index++) {
    const [user] = await database.db.insert(users).values({ email: `count-matrix-${crypto.randomUUID()}@example.com`, displayName: "Count fixture" }).returning({ id: users.id });
    assert.ok(user); createdUsers.push(user.id);
  }
  const repository = new DrizzleMindProductRepository(database.db);
  const service = new MindProductService(repository, "G");
  const id = createdUsers[0]!;
  assert.equal((await service.list({ userId: id })).totalCount, 0);
  const keep = await service.createManual({ userId: id, kind: "memory", text: "Visible private fixture", idempotencyKey: crypto.randomUUID() });
  const dated = await service.createManual({ userId: id, kind: "memory", text: "Dated fixture", occurredAt: "2026-10-13T00:00:00Z", idempotencyKey: crypto.randomUUID() });
  const hidden = await service.createManual({ userId: id, kind: "memory", text: "Hidden fixture", idempotencyKey: crypto.randomUUID() });
  await database.db.update(runtimeSubjectStates).set({ envelope: sql`jsonb_set(${runtimeSubjectStates.envelope}, '{scope,visibility}', '"hidden_system"'::jsonb)` }).where(eq(runtimeSubjectStates.id, hidden.id));
  for (const update of [{ settlementStatus: "unsettled" }, { pathStatus: "superseded" }, { validityStatus: "invalidated" }, { validityStatus: "tombstoned" }] as const) {
    const item = await service.createManual({ userId: id, kind: "memory", text: "Excluded status fixture", idempotencyKey: crypto.randomUUID() });
    await database.db.update(runtimeSubjectStates).set(update).where(eq(runtimeSubjectStates.id, item.id));
  }
  const otherSubject = new MindProductService(repository, "C");
  await otherSubject.createManual({ userId: id, kind: "memory", text: "Other subject fixture", idempotencyKey: crypto.randomUUID() });
  await service.createManual({ userId: createdUsers[1]!, kind: "memory", text: "Other user fixture", idempotencyKey: crypto.randomUUID() });
  for (const sort of ["updated_desc", "occurred_desc"] as const) {
    const first = await service.list({ userId: id, sort, limit: 1 });
    assert.equal(first.totalCount, 2);
    assert.ok(first.nextCursor);
    const second = await service.list({ userId: id, sort, limit: 1, cursor: first.nextCursor });
    assert.equal(second.totalCount, 2);
    assert.deepEqual([...first.items, ...second.items].map(row => row.id).sort(), [keep.id, dated.id].sort());
    const undated = await service.list({ userId: id, sort, undated: true, limit: 1 });
    assert.equal(undated.totalCount, 2);
    assert.deepEqual(undated.items.map(row => row.id), [keep.id]);
  }
  assert.equal((await otherSubject.list({ userId: id })).totalCount, 1);
  assert.equal((await service.list({ userId: createdUsers[1]! })).totalCount, 1);
  await service.delete({ userId: id, stateId: dated.id });
  assert.equal((await service.list({ userId: id, limit: 1 })).totalCount, 1);
  for (let index = 0; index < 255; index++) {
    await service.createManual({ userId: id, kind: "memory", text: `Synthetic count fixture ${index}`, idempotencyKey: crypto.randomUUID() });
  }
  const large = await service.list({ userId: id, limit: 1, undated: true });
  assert.equal(large.totalCount, 256, "large global count is independent of the returned page");
  assert.equal(large.items.length, 1);
});

for (const operation of ["create", "delete"] as const) {
test(`Memory count and page use one snapshot during a concurrent ${operation}`, { skip: !enabled }, async (t) => {
  const url = process.env.DATABASE_URL;
  assert.ok(url && /test|scratch|regression/.test(new URL(url).pathname));
  const database = createDatabase(url, { ssl: false });
  const [user] = await database.db.insert(users).values({ email: `count-race-${crypto.randomUUID()}@example.com`, displayName: "Count race fixture" }).returning({ id: users.id });
  assert.ok(user);
  t.after(async () => {
    try {
      await database.db.delete(runtimeSubjectStates).where(eq(runtimeSubjectStates.userId, user.id));
      await database.db.delete(productCreateIdempotency).where(eq(productCreateIdempotency.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally { await database.close(); }
  });
  const writer = new MindProductService(new DrizzleMindProductRepository(database.db), "G");
  const previous = operation === "delete"
    ? await writer.createManual({ userId: user.id, kind: "memory", text: "Synthetic deletion fixture", idempotencyKey: crypto.randomUUID() })
    : null;
  let inserted = false;
  const afterCount = async () => {
    assert.equal(inserted, false);
    inserted = true;
    if (previous) await writer.delete({ userId: user.id, stateId: previous.id });
    else await writer.createManual({ userId: user.id, kind: "memory", text: "Concurrent synthetic fixture", idempotencyKey: crypto.randomUUID() });
  };
  function wrapCountBuilder<T extends object>(builder: T): T {
    return new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "then") return (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => value.call(target, async (result: unknown) => { await afterCount(); return resolve(result); }, reject);
        if (typeof value === "function") return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === "object" ? wrapCountBuilder(result) : result;
        };
        return value;
      },
    });
  }
  function wrapDatabase<T extends object>(db: T): T {
    return new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === "transaction") return (callback: (tx: unknown) => unknown, options: unknown) => value.call(target, (tx: object) => callback(wrapDatabase(tx)), options);
        if (property === "select") return (selection: Record<string, unknown>) => {
          const builder = value.call(target, selection);
          return "totalCount" in selection ? wrapCountBuilder(builder) : builder;
        };
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  const reader = new MindProductService(new DrizzleMindProductRepository(wrapDatabase(database.db)), "G");
  const page = await reader.list({ userId: user.id });
  assert.equal(inserted, true, "write commits exactly after count query resolves");
  assert.equal(page.totalCount, previous ? 1 : 0);
  assert.deepEqual(page.items.map(row => row.id), previous ? [previous.id] : [], "same response must not mix old count and new rows");
  assert.equal((await writer.list({ userId: user.id })).totalCount, previous ? 0 : 1);
});

}
