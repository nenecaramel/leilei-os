import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations as conversationRows,
  runtimeContextManifests,
  runtimeSubjectStateTransitions,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

const enabled = process.env.RUN_RUNTIME_MIND_DATABASE_TEST === "1";

test(
  "Runtime Mind persistence keeps provisional path scope, transition history, global settlement, and Context Manifests",
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
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, cleanupUserId));
          await database.db
            .delete(conversationRows)
            .where(eq(conversationRows.userId, cleanupUserId));
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
        email: `runtime-mind-${suffix}@example.com`,
        displayName: "Runtime Mind DB Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    cleanupUserId = user.id;

    const conversations = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const firstConversation = await conversations.createConversation({
      userId: user.id,
      title: "Mind persistence A",
    });
    const secondConversation = await conversations.createConversation({
      userId: user.id,
      title: "Mind persistence B",
    });

    const rootUser = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: firstConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", rawType: "text", text: "root" }],
    });
    const rootAssistant = await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: firstConversation.id,
      parentMessageId: rootUser.id,
      blocks: [{ kind: "text", rawType: "text", text: "reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `runtime-mind-${suffix}`,
      },
    });

    const port = new DrizzleSubjectStateRuntimePort(database.db);
    const stateId = crypto.randomUUID();
    const provisional: SubjectStateWrite = {
      id: stateId,
      kind: "memory",
      text: "Runtime Mind DB marker",
      payload: null,
      envelope: {
        semanticActor: { kind: "subject", id: "G" },
        producer: { kind: "model", id: "claude-code" },
        committer: { kind: "runtime", id: "leileios-runtime" },
        authority: "subject_authorized",
        scope: {
          userId: user.id,
          subjectId: "G",
          applicability: "path",
          conversationId: firstConversation.id,
          pathHeadMessageId: rootAssistant.message.id,
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
          sources: [{ kind: "message", id: rootAssistant.message.id }],
          causedBy: rootAssistant.message.id,
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "mind-v1",
          processVersion: "subject-write-v1",
        },
      },
    };

    await port.append({
      userId: user.id,
      subjectId: "G",
      states: [provisional],
    });

    const firstScoped = await port.list({
      userId: user.id,
      subjectId: "G",
      conversationId: firstConversation.id,
    });
    assert.deepEqual(firstScoped.map((state) => state.id), [stateId]);

    const otherBeforeSettlement = await port.list({
      userId: user.id,
      subjectId: "G",
      conversationId: secondConversation.id,
    });
    assert.deepEqual(otherBeforeSettlement, []);

    await port.transition({
      userId: user.id,
      subjectId: "G",
      conversationId: firstConversation.id,
      transitions: [{
        stateId,
        reason: "user_continued_current_path",
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        promoteScopeToGlobal: true,
      }],
    });

    const globalFromOtherConversation = await port.list({
      userId: user.id,
      subjectId: "G",
      conversationId: secondConversation.id,
    });
    assert.equal(globalFromOtherConversation.length, 1);
    assert.equal(
      globalFromOtherConversation[0]?.envelope.status.settlementStatus,
      "settled",
    );
    assert.equal(
      globalFromOtherConversation[0]?.envelope.scope.applicability,
      "global",
    );

    const manifestId = crypto.randomUUID();
    await port.saveContextManifest({
      manifest: {
        manifestId,
        userId: user.id,
        subjectId: "G",
        conversationId: firstConversation.id,
        pathHeadMessageId: rootAssistant.message.id,
        snapshotSequence: 2,
        assemblyVersion: "assembly-v1",
        promptContractVersion: "prompt-v1",
        createdAt: "2026-09-22T08:50:00.000Z",
        budget: {
          maxItems: 8,
          maxChars: 4000,
          usedItems: 1,
          usedChars: 6,
          overflowPolicy: "drop_lowest_rank",
        },
        items: [{
          id: `subject-state:${stateId}`,
          type: "memory",
          sourceId: stateId,
          authority: "data",
          trustBoundary: "subject_state_data",
          text: "marker",
          selection: {
            reason: "breath_lexical_match",
            rank: 300,
            score: 1,
            truncated: false,
          },
        }],
      },
    });

    const manifests = await database.db
      .select({
        id: runtimeContextManifests.id,
        subjectId: runtimeContextManifests.subjectId,
        conversationId: runtimeContextManifests.conversationId,
      })
      .from(runtimeContextManifests)
      .where(
        and(
          eq(runtimeContextManifests.userId, user.id),
          eq(runtimeContextManifests.id, manifestId),
        ),
      );
    assert.deepEqual(manifests, [{
      id: manifestId,
      subjectId: "G",
      conversationId: firstConversation.id,
    }]);

    const transitions = await database.db
      .select({
        stateId: runtimeSubjectStateTransitions.stateId,
        reason: runtimeSubjectStateTransitions.reason,
      })
      .from(runtimeSubjectStateTransitions)
      .where(
        and(
          eq(runtimeSubjectStateTransitions.userId, user.id),
          eq(runtimeSubjectStateTransitions.stateId, stateId),
        ),
      );
    assert.deepEqual(transitions, [{
      stateId,
      reason: "user_continued_current_path",
    }]);

    assert.equal(
      (await conversations.archiveConversation({
        userId: user.id,
        conversationId: firstConversation.id,
      })).outcome,
      "archived",
    );

    const blockedState: SubjectStateWrite = {
      ...provisional,
      id: crypto.randomUUID(),
      text: "must not be written from archived source",
      envelope: {
        ...provisional.envelope,
        scope: {
          ...provisional.envelope.scope,
        },
        provenance: {
          ...provisional.envelope.provenance,
          sources: [{
            kind: "message",
            id: rootAssistant.message.id,
          }],
        },
      },
    };
    await assert.rejects(
      port.append({
        userId: user.id,
        subjectId: "G",
        sourceConversationId: firstConversation.id,
        states: [blockedState],
      }),
      /SubjectStateSourceConversationInactive/,
    );

    await assert.rejects(
      port.transition({
        userId: user.id,
        subjectId: "G",
        conversationId: firstConversation.id,
        transitions: [{
          stateId,
          reason: "user_continued_current_path",
          settlementStatus: "settled",
          pathStatus: "current",
          validityStatus: "valid",
          promoteScopeToGlobal: true,
        }],
      }),
      /SubjectStateSourceConversationInactive/,
    );

    await port.recordBreathRecall({
      userId: user.id,
      subjectId: "G",
      stateIds: [stateId],
      recalledAt: "2026-09-22T09:00:00.000Z",
      salienceBoost: 0.08,
      sourceMessageId: rootUser.id,
    });
    const [afterArchivedRecall] = await database.db
      .select({ payload: runtimeSubjectStates.payload })
      .from(runtimeSubjectStates)
      .where(and(
        eq(runtimeSubjectStates.userId, user.id),
        eq(runtimeSubjectStates.id, stateId),
      ));
    assert.equal(afterArchivedRecall?.payload, null);

    await assert.rejects(
      port.saveContextManifest({
        manifest: {
          manifestId: crypto.randomUUID(),
          userId: user.id,
          subjectId: "G",
          conversationId: firstConversation.id,
          pathHeadMessageId: rootAssistant.message.id,
          snapshotSequence: 3,
          assemblyVersion: "assembly-v1",
          promptContractVersion: "prompt-v1",
          createdAt: "2026-09-22T09:00:00.000Z",
          budget: {
            maxItems: 8,
            maxChars: 4000,
            usedItems: 0,
            usedChars: 0,
            overflowPolicy: "drop_lowest_rank",
          },
          items: [],
        },
      }),
      /ContextManifestSourceConversationInactive/,
    );
  },
);
