import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveProviderSessionCleanups,
  productCreateIdempotency,
  users,
  workspaceConversations,
  workspaceResources,
  workspaces,
} from "../src/database/schema.js";
import {
  DrizzleProjectWorkspaceRepository,
} from "../src/domains/project-workspace/project-workspace-repository.js";
import {
  ProjectWorkspaceService,
  ProjectWorkspaceServiceError,
} from "../src/domains/project-workspace/project-workspace-service.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";

const enabled =
  process.env.RUN_PROJECT_WORKSPACE_DATABASE_TEST === "1";

test(
  "single-layer Workspace persists resources and conversation membership without Project backing rows",
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
            .delete(workspaceConversations)
            .where(eq(workspaceConversations.userId, userId));
          await database.db
            .delete(workspaceResources)
            .where(eq(workspaceResources.userId, userId));
          await database.db
            .delete(workspaces)
            .where(eq(workspaces.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(productCreateIdempotency)
            .where(eq(productCreateIdempotency.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `workspace-${crypto.randomUUID()}@example.com`,
        displayName: "Workspace DB Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new ProjectWorkspaceService(
      new DrizzleProjectWorkspaceRepository(database.db),
    );
    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );

    const workspace = await service.createProductWorkspace({
      userId,
      name: "LeileiOS",
      description: "single durable layer",
      idempotencyKey: "workspace-db-create-0001",
    });
    const replay = await service.createProductWorkspace({
      userId,
      name: "LeileiOS",
      description: "single durable layer",
      idempotencyKey: "workspace-db-create-0001",
    });
    assert.deepEqual(replay, workspace);

    assert.deepEqual(
      await database.db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(and(
          eq(workspaces.userId, userId),
          eq(workspaces.id, workspace.id),
        )),
      [{ id: workspace.id, name: "LeileiOS" }],
    );

    const resource = await service.createWorkspaceResource({
      userId,
      workspaceId: workspace.id,
      kind: "instructions",
      key: "default",
      content: "Use Workspace context.",
      idempotencyKey: "workspace-resource-db-0001",
    });
    assert.equal(resource.workspaceId, workspace.id);
    assert.equal(
      Object.prototype.hasOwnProperty.call(resource, "projectId"),
      false,
    );

    const conversation = await conversationService.createConversation({
      userId,
      title: "Workspace conversation",
    });
    assert.deepEqual(
      await service.attachWorkspaceConversation({
        userId,
        workspaceId: workspace.id,
        conversationId: conversation.id,
      }),
      { applied: true },
    );
    assert.deepEqual(
      await service.attachWorkspaceConversation({
        userId,
        workspaceId: workspace.id,
        conversationId: conversation.id,
      }),
      { applied: false },
    );

    assert.equal(
      (
        await database.db
          .select({ conversationId: workspaceConversations.conversationId })
          .from(workspaceConversations)
          .where(and(
            eq(workspaceConversations.workspaceId, workspace.id),
            eq(workspaceConversations.conversationId, conversation.id),
          ))
      ).length,
      1,
    );

    await service.deleteProductWorkspace({
      userId,
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
    });

    assert.equal(
      (
        await database.db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, workspace.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await database.db
          .select({ id: workspaceResources.id })
          .from(workspaceResources)
          .where(eq(workspaceResources.workspaceId, workspace.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await database.db
          .select({ conversationId: workspaceConversations.conversationId })
          .from(workspaceConversations)
          .where(eq(workspaceConversations.workspaceId, workspace.id))
      ).length,
      0,
    );
    assert.ok(
      await conversationService.getConversation({
        userId,
        conversationId: conversation.id,
      }),
      "Workspace deletion must preserve canonical Conversation history",
    );
  },
);

test(
  "Workspace deletion fails closed while a canonical provider checkpoint binds it",
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
            .delete(workspaceConversations)
            .where(eq(workspaceConversations.userId, userId));
          await database.db
            .delete(workspaceResources)
            .where(eq(workspaceResources.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(workspaces)
            .where(eq(workspaces.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(productCreateIdempotency)
            .where(eq(productCreateIdempotency.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `workspace-bound-${crypto.randomUUID()}@example.com`,
        displayName: "Workspace Bound Test",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new ProjectWorkspaceService(
      new DrizzleProjectWorkspaceRepository(database.db),
    );
    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );

    const workspace = await service.createProductWorkspace({
      userId,
      name: "Bound Workspace",
      idempotencyKey: "workspace-bound-db-0001",
    });
    const conversation = await conversationService.createConversation({
      userId,
      title: "Bound conversation",
    });
    const userMessage = await conversationService.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "hello" }],
    });
    await conversationService.completeAssistantTurn({
      userId,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "workspace-bound-session",
        workspaceId: workspace.id,
        effectiveWorkspaceRoot: "/Users/leilei/Bound",
      },
    });

    await assert.rejects(
      service.deleteProductWorkspace({
        userId,
        workspaceId: workspace.id,
        expectedVersion: workspace.version,
      }),
      (error: unknown) =>
        error instanceof ProjectWorkspaceServiceError
        && error.code === "WORKSPACE_IN_USE",
    );

    assert.ok(
      await service.getProductWorkspace({
        userId,
        workspaceId: workspace.id,
      }),
    );

    assert.equal(
      (
        await conversationService.deleteConversation({
          userId,
          conversationId: conversation.id,
        })
      ).outcome,
      "deleted",
    );

    await service.deleteProductWorkspace({
      userId,
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
    });
    await assert.rejects(
      service.getProductWorkspace({
        userId,
        workspaceId: workspace.id,
      }),
      (error: unknown) =>
        error instanceof ProjectWorkspaceServiceError
        && error.code === "WORKSPACE_NOT_FOUND",
    );
  },
);
