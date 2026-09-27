import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { count, eq } from "drizzle-orm";
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
  "real v3 product backup round-trips linked durable state",
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
    const mindId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
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
        currentHeadMessageId: assistantMessageId,
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

      await db.insert(schema.runtimeSubjectStates).values({
        id: mindId,
        userId,
        subjectId: "claude",
        kind: "memory",
        text: "Durable memory",
        payload: null,
        scopeApplicability: "path",
        scopeConversationId: conversationId,
        scopePathHeadMessageId: assistantMessageId,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "subject_authorized",
        },
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.projectWorkspaces).values({
        id: workspaceId,
        userId,
        name: "Workspace",
        description: "Portable workspace",
        version: 2,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.projects).values({
        id: projectId,
        userId,
        workspaceId,
        name: "Project",
        description: null,
        version: 3,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.projectResources).values({
        id: resourceId,
        userId,
        projectId,
        kind: "file",
        resourceKey: "context.md",
        title: "Context",
        content: "Project context",
        metadata: { portable: true },
        version: 4,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.projectConversations).values({
        userId,
        projectId,
        conversationId,
        addedAt: now,
      });

      const exported = await new ExportService(
        new DrizzleExportRepository(
          db as never,
        ),
        () => now,
      ).createExport(userId, "all", false);

      assert.deepEqual(
        Object.keys(exported.data),
        [
          "diary",
          "diary_comments",
          "todo",
          "projects",
          "mind",
          "conversations",
          "universe",
        ],
      );

      await db
        .delete(schema.projectConversations)
        .where(eq(schema.projectConversations.userId, userId));
      await db
        .delete(schema.projectResources)
        .where(eq(schema.projectResources.userId, userId));
      await db
        .delete(schema.projects)
        .where(eq(schema.projects.userId, userId));
      await db
        .delete(schema.projectWorkspaces)
        .where(eq(schema.projectWorkspaces.userId, userId));
      await db
        .delete(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.userId, userId));
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
      assert.equal(preview.summary.mind?.create, 1);
      assert.equal(preview.summary.projects?.create, 4);
      assert.equal(
        preview.summary.conversations?.create,
        4,
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
        mindCount,
        universeMetaCount,
        universeSourceCount,
        workspaceCount,
        projectCount,
        resourceCount,
        membershipCount,
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
          .from(schema.runtimeSubjectStates)
          .where(eq(schema.runtimeSubjectStates.userId, userId)),
        db.select({ count: count() })
          .from(schema.universeMeta)
          .where(eq(schema.universeMeta.userId, userId)),
        db.select({ count: count() })
          .from(schema.universeDiarySources)
          .where(eq(schema.universeDiarySources.userId, userId)),
        db.select({ count: count() })
          .from(schema.projectWorkspaces)
          .where(eq(schema.projectWorkspaces.userId, userId)),
        db.select({ count: count() })
          .from(schema.projects)
          .where(eq(schema.projects.userId, userId)),
        db.select({ count: count() })
          .from(schema.projectResources)
          .where(eq(schema.projectResources.userId, userId)),
        db.select({ count: count() })
          .from(schema.projectConversations)
          .where(eq(schema.projectConversations.userId, userId)),
      ]);

      assert.equal(diaryCount[0]?.count, 1);
      assert.equal(commentCount[0]?.count, 1);
      assert.equal(todoCount[0]?.count, 1);
      assert.equal(conversationCount[0]?.count, 1);
      assert.equal(messageCount[0]?.count, 2);
      assert.equal(blockCount[0]?.count, 1);
      assert.equal(mindCount[0]?.count, 1);
      assert.equal(universeMetaCount[0]?.count, 1);
      assert.equal(universeSourceCount[0]?.count, 1);
      assert.equal(workspaceCount[0]?.count, 1);
      assert.equal(projectCount[0]?.count, 1);
      assert.equal(resourceCount[0]?.count, 1);
      assert.equal(membershipCount[0]?.count, 1);

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

      const [restoredMembership] = await db
        .select({
          projectId:
            schema.projectConversations.projectId,
          conversationId:
            schema.projectConversations.conversationId,
        })
        .from(schema.projectConversations)
        .where(
          eq(
            schema.projectConversations.userId,
            userId,
          ),
        );
      assert.deepEqual(restoredMembership, {
        projectId,
        conversationId,
      });
    } finally {
      await db
        .delete(schema.projectConversations)
        .where(eq(schema.projectConversations.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.projectResources)
        .where(eq(schema.projectResources.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.projects)
        .where(eq(schema.projects.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.projectWorkspaces)
        .where(eq(schema.projectWorkspaces.userId, userId))
        .catch(() => undefined);
      await db
        .delete(schema.runtimeSubjectStates)
        .where(eq(schema.runtimeSubjectStates.userId, userId))
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
