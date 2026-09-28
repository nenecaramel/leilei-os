import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveBackgroundModelJobs,
  runtimeSubjectStates,
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
        payload: {
          thought_v1: {
            role: "anchor",
            anchorStateId: manual.id,
          },
        },
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
        kind: "curiosity",
        text: "exclusive dependent curiosity",
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
    assert.equal(shared.payload, null);
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
