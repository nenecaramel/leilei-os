import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { ExportService } from "../src/domains/export/export-service.js";
import { DrizzleImportRepository } from "../src/domains/import/import-repository.js";
import { ImportService } from "../src/domains/import/import-service.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration =
  process.env.RUN_IMPORT_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (
    parsedUrl?.hostname === "127.0.0.1"
    || parsedUrl?.hostname === "localhost"
  );

test(
  "real v4 memory-only backup round-trips historical Continuity with current foreign keys",
  { skip: !runIntegration },
  async () => {
    const client = postgres(
      databaseUrl!,
      { max: 1, prepare: false, ssl: false },
    );
    const db = drizzle(client, { schema });
    const userId = randomUUID();
    const diaryId = randomUUID();
    const commentId = randomUUID();
    const paperId = randomUUID();
    const conversationId = randomUUID();
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const contentBlockId = randomUUID();
    const checkpointId = randomUUID();
    const mindId = randomUUID();
    const driveId = randomUUID();
    const driveCandidateId = randomUUID();
    const driveEventId = randomUUID();
    const groupingResultId = randomUUID();
    const curiosityId = randomUUID();
    const curiosityEventId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = workspaceId;
    const resourceId = randomUUID();
    const now =
      new Date("2026-08-14T00:00:00.000Z");

    try {
      await db.insert(schema.users).values({
        id: userId,
        email:
          `import-v3-${userId}@example.invalid`,
        displayName: "Import v3 product backup",
        status: "active",
      });

      await db.insert(schema.diaryEntries).values({
        id: diaryId,
        userId,
        title: "Round trip diary",
        content: "Diary content",
        date: "2026-08-13",
        tags: ["roundtrip"],
        mood: null,
        source: "chatgpt_mcp",
        author: "C",
        status: "active",
        idempotencyKey:
          `roundtrip-diary-${userId}`,
        requestHash: "a".repeat(64),
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.diaryComments).values({
        id: commentId,
        userId,
        diaryId,
        author: "G",
        content: "Diary comment",
        revision: 2,
        idempotencyKey:
          `roundtrip-comment-${userId}`,
        requestHash: "b".repeat(64),
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.universeMeta).values({
        userId,
        name: "Round trip Universe",
        schemaVersion: 2,
        version: 7,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.universeGalaxies).values({
        userId,
        id: "galaxy-1",
        title: "Galaxy",
        description: "Description",
        color: "#ffffff",
        order: 0,
      });
      await db.insert(schema.universeNodes).values({
        userId,
        id: "node-1",
        title: "Node",
        summary: "Summary",
        content: "Content",
        type: "idea",
        tags: ["portable"],
        galaxies: [],
        galaxyMemberships: [{
          id: "galaxy-1",
          weight: 1,
        }],
        position: { x: 1, y: 2 },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.universeDiarySources).values({
        userId,
        nodeId: "node-1",
        diaryId,
      });

      await db.insert(schema.todoPapers).values({
        id: paperId,
        userId,
        businessDate: "2026-08-13",
        author: "C",
        revision: 2,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.todoEntries).values({
        paperId,
        entryId: "entry-1",
        kind: "pending",
        text: "Round trip todo",
        position: 0,
      });

      await db.insert(schema.conversations).values({
        id: conversationId,
        userId,
        origin: "native_live",
        title: "Round trip conversation",
        lifecycleStatus: "active",
        currentHeadMessageId: null,
        defaultModel: "claude-sonnet",
        providerMetadata: { portable: true },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.conversationMessages).values([
        {
          id: userMessageId,
          userId,
          conversationId,
          parentMessageId: null,
          role: "user",
          status: "completed",
          isCurrentPath: true,
          currentPathIndex: 0,
          turnIndex: 0,
          isPrimary: true,
          displayText: "hello",
          createdAt: now,
          completedAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          userId,
          conversationId,
          parentMessageId: userMessageId,
          role: "assistant",
          status: "completed",
          model: "claude-sonnet",
          isCurrentPath: true,
          currentPathIndex: 1,
          turnIndex: 0,
          isPrimary: true,
          displayText: "hi",
          createdAt: now,
          completedAt: now,
          updatedAt: now,
        },
      ]);
      await db
        .update(schema.conversations)
        .set({ currentHeadMessageId: assistantMessageId })
        .where(and(
          eq(schema.conversations.userId, userId),
          eq(schema.conversations.id, conversationId),
        ));

      await db.insert(schema.conversationContentBlocks).values({
        id: contentBlockId,
        userId,
        messageId: assistantMessageId,
        ordinal: 0,
        kind: "text",
        rawType: "text",
        text: "hi",
        payload: null,
        createdAt: now,
      });
      await db
        .insert(schema.conversationProviderSessionCheckpoints)
        .values({
          id: checkpointId,
          userId,
          conversationId,
          canonicalMessageId: assistantMessageId,
          provider: "claude_code",
          providerSessionId: "roundtrip-session-1",
          runtimeMetadata: {
            context_window: 200000,
            compacted: false,
          },
          providerCheckpointId: "roundtrip-checkpoint-1",
          createdAt: now,
        });

      await db.insert(schema.runtimeSubjectStates).values({
        id: mindId,
        userId,
        subjectId: "claude",
        kind: "memory",
        text: "  Durable memory\nwith its original whitespace  ",
        payload: {
          temporal_v1: { occurredAt: "2026-08-01T12:34:56.000Z" },
          lifecycle_v1: { status: "active", reinforcementCount: 3, salience: 0.7 },
          source: "manual",
        },
        scopeApplicability: "path",
        scopeConversationId: conversationId,
        scopePathHeadMessageId: assistantMessageId,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "subject_authorized",
          provenance: { sources: [{ kind: "conversation_message", id: assistantMessageId }] },
        },
        createdAt: now,
        updatedAt: now,
      });
      const [storedMemory] = await db.select().from(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.id, mindId));
      assert.ok(storedMemory);
      await assert.rejects(
        db.insert(schema.runtimeSubjectStates).values({
          ...storedMemory, id: randomUUID(), kind: "thought" as never,
        }),
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
          return cause?.code === "23514"
            && cause.constraint_name === "runtime_subject_states_kind_allowed";
        },
      );
      await assert.rejects(new DrizzleImportRepository(db as never).insertMind(userId, {
        id: randomUUID(), subject_id: "claude", kind: "drive", text: "retired",
        payload: null, scope_applicability: "global", scope_conversation_id: null,
        scope_path_head_message_id: null, settlement_status: "settled", path_status: "current",
        validity_status: "valid", envelope: {}, created_at: now.toISOString(), updated_at: now.toISOString(),
      }), /current memory kind/);

      await db.insert(schema.runtimeSubjectStates).values({
        id: driveId,
        userId,
        subjectId: "claude",
        kind: "memory",
        text: "Durable drive",
        payload: {
          drive_v1: {
            role: "anchor",
            anchorStateId: driveId,
            pressure: 0.5,
            phase: "active",
            satisfactionTotal: 0.5,
            lastEvolvedAt: now.toISOString(),
            lastSatisfiedAt: now.toISOString(),
            dormantAt: null,
          },
        },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "subject_authorized",
        },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.runtimeSubjectStates).values({
        id: driveCandidateId,
        userId,
        subjectId: "claude",
        kind: "memory",
        text: "Earlier durable drive",
        payload: {
          drive_v1: {
            role: "anchor",
            anchorStateId: driveCandidateId,
            pressure: 0.8,
            phase: "active",
            satisfactionTotal: 0,
            lastEvolvedAt: now.toISOString(),
            lastSatisfiedAt: null,
            dormantAt: null,
          },
        },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "subject_authorized",
        },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.runtimeMindSemanticGroupingRequests).values({
        id: groupingResultId,
        userId,
        subjectId: "claude",
        kind: "drive",
        queryStateId: driveId,
        query: "Durable drive",
        candidates: [{
          stateId: driveCandidateId,
          kind: "drive",
          text: "Earlier durable drive",
        }],
        status: "completed",
        scores: {
          [driveCandidateId]: 0.91,
        },
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.runtimeDriveSatisfactionEvents).values({
        id: driveEventId,
        userId,
        subjectId: "claude",
        driveStateId: driveId,
        conversationId,
        evidenceMessageId: assistantMessageId,
        evidenceBlockId: null,
        evidenceKind: "assistant_message",
        amount: 0.5,
        idempotencyKey: `roundtrip-drive-${userId}`,
        createdAt: now,
      });
      await db.insert(schema.runtimeSubjectStates).values({
        id: curiosityId,
        userId,
        subjectId: "claude",
        kind: "memory",
        text: "Durable curiosity",
        payload: {
          curiosity_v1: {
            role: "anchor",
            anchorStateId: curiosityId,
            phase: "resolved",
            resolvedAt: now.toISOString(),
            resolutionSourceId: assistantMessageId,
          },
        },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "subject_authorized",
        },
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.runtimeCuriosityResolutionEvents).values({
        id: curiosityEventId,
        userId,
        subjectId: "claude",
        curiosityStateId: curiosityId,
        conversationId,
        requestedResolutionSourceId: assistantMessageId,
        resultResolutionSourceId: assistantMessageId,
        resolvedAt: now,
        idempotencyKey: `roundtrip-curiosity-${userId}`,
        createdAt: now,
      });
      await db.insert(schema.runtimeDistillationWatermarks).values({
        userId,
        subjectId: "claude",
        conversationId,
        lastSourceMessageId: assistantMessageId,
        processVersion: "distill-v1",
        updatedAt: now,
      });

      await db.delete(schema.runtimeSubjectStates).where(eq(schema.runtimeSubjectStates.id, driveCandidateId));

      const exported = await new ExportService(
        new DrizzleExportRepository(
          db as never,
        ),
        () => now,
      ).createExport(userId);

      assert.equal(exported.schema_version, 4);
      assert.equal("audit" in exported, false);
      assert.equal(exported.data.mind?.length, 3);
      assert.ok(exported.data.mind?.every(record => record.kind === "memory"));
      assert.equal(exported.data.mind_continuity?.drive_satisfaction_events.length, 1);
      assert.equal(exported.data.mind_continuity?.curiosity_resolution_events.length, 1);
      assert.equal(exported.data.mind_continuity?.semantic_grouping_results.length, 1);
      assert.equal(exported.data.mind_continuity?.distillation_watermarks.length, 1);
      assert.deepEqual(
        Object.keys(exported.data),
        [
          "diary",
          "diary_comments",
          "todo",
          "mind",
          "mind_continuity",
          "conversations",
          "universe",
        ],
      );

      await db
        .delete(schema.runtimeDriveSatisfactionEvents)
        .where(eq(schema.runtimeDriveSatisfactionEvents.userId, userId));
      await db
        .delete(schema.runtimeMindSemanticGroupingRequests)
        .where(eq(schema.runtimeMindSemanticGroupingRequests.userId, userId));
      await db
        .delete(schema.runtimeCuriosityResolutionEvents)
        .where(eq(schema.runtimeCuriosityResolutionEvents.userId, userId));
      await db
        .delete(schema.runtimeDistillationWatermarks)
        .where(eq(schema.runtimeDistillationWatermarks.userId, userId));
      await db
        .delete(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.userId, userId));
      await db
        .delete(schema.conversationProviderSessionCheckpoints)
        .where(
          eq(
            schema.conversationProviderSessionCheckpoints.userId,
            userId,
          ),
        );
      await db
        .delete(schema.conversationContentBlocks)
        .where(eq(schema.conversationContentBlocks.userId, userId));
      await db
        .delete(schema.conversationMessages)
        .where(eq(schema.conversationMessages.userId, userId));
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.userId, userId));
      await db
        .delete(schema.universeDiarySources)
        .where(eq(schema.universeDiarySources.userId, userId));
      await db
        .delete(schema.universeRelations)
        .where(eq(schema.universeRelations.userId, userId));
      await db
        .delete(schema.universeRevisions)
        .where(eq(schema.universeRevisions.userId, userId));
      await db
        .delete(schema.universeNodes)
        .where(eq(schema.universeNodes.userId, userId));
      await db
        .delete(schema.universeGalaxies)
        .where(eq(schema.universeGalaxies.userId, userId));
      await db
        .delete(schema.universeMeta)
        .where(eq(schema.universeMeta.userId, userId));

      await db
        .delete(schema.todoPapers)
        .where(eq(schema.todoPapers.userId, userId));
      await db
        .delete(schema.diaryComments)
        .where(eq(schema.diaryComments.userId, userId));
      await db
        .delete(schema.diaryEntries)
        .where(eq(schema.diaryEntries.userId, userId));

      const raw = new TextEncoder().encode(
        JSON.stringify(exported),
      );
      const service = new ImportService(
        new DrizzleImportRepository(
          db as never,
        ),
      );
      const preview = await service.preview(
        raw,
        userId,
      );

      assert.equal(preview.summary.diary.create, 1);
      assert.equal(
        preview.summary.diary_comments?.create,
        1,
      );
      assert.equal(preview.summary.todo.create, 1);
      assert.equal(preview.summary.universe?.create, 1);
      assert.equal(preview.summary.mind?.create, 7);
      assert.equal(
        preview.summary.conversations?.create,
        5,
      );
      assert.equal(preview.can_execute, true);

      await service.execute(
        raw,
        userId,
        preview.preview_fingerprint,
      );

      const [
        diaryCount,
        commentCount,
        todoCount,
        conversationCount,
        messageCount,
        blockCount,
        checkpointCount,
        mindCount,
        driveEventCount,
        curiosityEventCount,
        groupingResultCount,
        watermarkCount,
        universeMetaCount,
        universeSourceCount,
      ] = await Promise.all([
        db.select({ count: count() })
          .from(schema.diaryEntries)
          .where(eq(schema.diaryEntries.userId, userId)),
        db.select({ count: count() })
          .from(schema.diaryComments)
          .where(eq(schema.diaryComments.userId, userId)),
        db.select({ count: count() })
          .from(schema.todoPapers)
          .where(eq(schema.todoPapers.userId, userId)),
        db.select({ count: count() })
          .from(schema.conversations)
          .where(eq(schema.conversations.userId, userId)),
        db.select({ count: count() })
          .from(schema.conversationMessages)
          .where(eq(schema.conversationMessages.userId, userId)),
        db.select({ count: count() })
          .from(schema.conversationContentBlocks)
          .where(eq(schema.conversationContentBlocks.userId, userId)),
        db.select({ count: count() })
          .from(schema.conversationProviderSessionCheckpoints)
          .where(
            eq(
              schema.conversationProviderSessionCheckpoints.userId,
              userId,
            ),
          ),
        db.select({ count: count() })
          .from(schema.runtimeSubjectStates)
          .where(eq(schema.runtimeSubjectStates.userId, userId)),
        db.select({ count: count() })
          .from(schema.runtimeDriveSatisfactionEvents)
          .where(eq(schema.runtimeDriveSatisfactionEvents.userId, userId)),
        db.select({ count: count() })
          .from(schema.runtimeCuriosityResolutionEvents)
          .where(eq(schema.runtimeCuriosityResolutionEvents.userId, userId)),
        db.select({ count: count() })
          .from(schema.runtimeMindSemanticGroupingRequests)
          .where(eq(schema.runtimeMindSemanticGroupingRequests.userId, userId)),
        db.select({ count: count() })
          .from(schema.runtimeDistillationWatermarks)
          .where(eq(schema.runtimeDistillationWatermarks.userId, userId)),
        db.select({ count: count() })
          .from(schema.universeMeta)
          .where(eq(schema.universeMeta.userId, userId)),
        db.select({ count: count() })
          .from(schema.universeDiarySources)
          .where(eq(schema.universeDiarySources.userId, userId)),
      ]);

      assert.equal(diaryCount[0]?.count, 1);
      assert.equal(commentCount[0]?.count, 1);
      assert.equal(todoCount[0]?.count, 1);
      assert.equal(conversationCount[0]?.count, 1);
      assert.equal(messageCount[0]?.count, 2);
      assert.equal(blockCount[0]?.count, 1);
      assert.equal(checkpointCount[0]?.count, 1);
      assert.equal(mindCount[0]?.count, 3);
      assert.equal(driveEventCount[0]?.count, 1);
      assert.equal(curiosityEventCount[0]?.count, 1);
      assert.equal(groupingResultCount[0]?.count, 1);
      assert.equal(watermarkCount[0]?.count, 1);
      assert.equal(universeMetaCount[0]?.count, 1);
      assert.equal(universeSourceCount[0]?.count, 1);

      const [restoredUniverse] = await db
        .select({
          version: schema.universeMeta.version,
          name: schema.universeMeta.name,
        })
        .from(schema.universeMeta)
        .where(eq(schema.universeMeta.userId, userId));
      assert.deepEqual(restoredUniverse, {
        version: 7,
        name: "Round trip Universe",
      });

      const [restoredCheckpoint] = await db
        .select({
          providerSessionId:
            schema.conversationProviderSessionCheckpoints.providerSessionId,
          runtimeMetadata:
            schema.conversationProviderSessionCheckpoints.runtimeMetadata,
          providerCheckpointId:
            schema.conversationProviderSessionCheckpoints.providerCheckpointId,
        })
        .from(schema.conversationProviderSessionCheckpoints)
        .where(
          eq(
            schema.conversationProviderSessionCheckpoints.id,
            checkpointId,
          ),
        );
      assert.deepEqual(restoredCheckpoint, {
        providerSessionId: "roundtrip-session-1",
        runtimeMetadata: {
          context_window: 200000,
          compacted: false,
        },
        providerCheckpointId: "roundtrip-checkpoint-1",
      });

      const [restoredConversation] = await db
        .select({
          currentHeadMessageId:
            schema.conversations.currentHeadMessageId,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId));
      assert.equal(
        restoredConversation?.currentHeadMessageId,
        assistantMessageId,
      );

      const [restoredDriveEvent] = await db
        .select({
          driveStateId:
            schema.runtimeDriveSatisfactionEvents.driveStateId,
          amount:
            schema.runtimeDriveSatisfactionEvents.amount,
        })
        .from(schema.runtimeDriveSatisfactionEvents)
        .where(
          eq(
            schema.runtimeDriveSatisfactionEvents.id,
            driveEventId,
          ),
        );
      assert.deepEqual(restoredDriveEvent, {
        driveStateId: driveId,
        amount: 0.5,
      });

      const [restoredCuriosityEvent] = await db
        .select({
          curiosityStateId:
            schema.runtimeCuriosityResolutionEvents.curiosityStateId,
          resultResolutionSourceId:
            schema.runtimeCuriosityResolutionEvents.resultResolutionSourceId,
        })
        .from(schema.runtimeCuriosityResolutionEvents)
        .where(
          eq(
            schema.runtimeCuriosityResolutionEvents.id,
            curiosityEventId,
          ),
        );
      assert.deepEqual(restoredCuriosityEvent, {
        curiosityStateId: curiosityId,
        resultResolutionSourceId: assistantMessageId,
      });

      const [restoredGrouping] = await db
        .select({
          queryStateId:
            schema.runtimeMindSemanticGroupingRequests.queryStateId,
          scores:
            schema.runtimeMindSemanticGroupingRequests.scores,
          status:
            schema.runtimeMindSemanticGroupingRequests.status,
        })
        .from(schema.runtimeMindSemanticGroupingRequests)
        .where(
          eq(
            schema.runtimeMindSemanticGroupingRequests.id,
            groupingResultId,
          ),
        );
      assert.deepEqual(restoredGrouping, {
        queryStateId: driveId,
        scores: {
          [driveCandidateId]: 0.91,
        },
        status: "completed",
      });

      const [restoredWatermark] = await db
        .select({
          lastSourceMessageId:
            schema.runtimeDistillationWatermarks.lastSourceMessageId,
          processVersion:
            schema.runtimeDistillationWatermarks.processVersion,
        })
        .from(schema.runtimeDistillationWatermarks)
        .where(
          eq(
            schema.runtimeDistillationWatermarks.userId,
            userId,
          ),
        );
      assert.deepEqual(restoredWatermark, {
        lastSourceMessageId: assistantMessageId,
        processVersion: "distill-v1",
      });

      const [restoredMind] = await db
        .select({
          conversationId:
            schema.runtimeSubjectStates.scopeConversationId,
          headMessageId:
            schema.runtimeSubjectStates.scopePathHeadMessageId,
        })
        .from(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.id, mindId));
      assert.deepEqual(restoredMind, {
        conversationId,
        headMessageId: assistantMessageId,
      });

      const reexported = await new ExportService(new DrizzleExportRepository(db as never), () => now)
        .createExport(userId);
      assert.deepEqual(reexported.data.mind, exported.data.mind);
      assert.deepEqual(reexported.data.mind_continuity, exported.data.mind_continuity);
      const repeated = await service.preview(raw, userId);
      assert.equal(repeated.summary.mind?.create, 0);
      assert.equal(repeated.summary.mind?.duplicate, 7);
      assert.equal(repeated.can_execute, false);
      await assert.rejects(service.execute(raw, userId, repeated.preview_fingerprint), /IMPORT_NOTHING_TO_RESTORE/);
      assert.deepEqual((await new ExportService(new DrizzleExportRepository(db as never), () => now)
        .createExport(userId)).data.mind_continuity, exported.data.mind_continuity);

    } finally {
      await db
        .delete(schema.runtimeDriveSatisfactionEvents)
        .where(eq(schema.runtimeDriveSatisfactionEvents.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.runtimeMindSemanticGroupingRequests)
        .where(eq(schema.runtimeMindSemanticGroupingRequests.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.runtimeCuriosityResolutionEvents)
        .where(eq(schema.runtimeCuriosityResolutionEvents.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.runtimeDistillationWatermarks)
        .where(eq(schema.runtimeDistillationWatermarks.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.conversationProviderSessionCheckpoints)
        .where(
          eq(
            schema.conversationProviderSessionCheckpoints.userId,
            userId,
          ),
        )
        .catch(() => undefined);
      await db
        .delete(schema.conversationContentBlocks)
        .where(eq(schema.conversationContentBlocks.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.conversationMessages)
        .where(eq(schema.conversationMessages.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.conversations)
        .where(eq(schema.conversations.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeDiarySources)
        .where(eq(schema.universeDiarySources.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeRelations)
        .where(eq(schema.universeRelations.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeRevisions)
        .where(eq(schema.universeRevisions.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeNodes)
        .where(eq(schema.universeNodes.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeGalaxies)
        .where(eq(schema.universeGalaxies.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.universeMeta)
        .where(eq(schema.universeMeta.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.todoPapers)
        .where(eq(schema.todoPapers.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.diaryComments)
        .where(eq(schema.diaryComments.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.diaryEntries)
        .where(eq(schema.diaryEntries.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.dataImportRuns)
        .where(eq(schema.dataImportRuns.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.users)
        .where(eq(schema.users.id, userId))
        .catch(() => undefined);
      await client.end();
    }
  },
);
