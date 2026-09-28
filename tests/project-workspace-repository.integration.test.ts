import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveProviderSessionCleanups,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleProjectWorkspaceRepository,
} from "../src/domains/project-workspace/project-workspace-repository.js";
import {
  ProjectWorkspaceService,
  ProjectWorkspaceServiceError,
} from "../src/domains/project-workspace/project-workspace-service.js";

const enabled =
  process.env.RUN_PROJECT_WORKSPACE_DATABASE_TEST === "1";

test(
  "Projects / Workspace durable CRUD preserves canonical conversations and cascades relations safely",
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
            .delete(projectConversations)
            .where(eq(projectConversations.userId, userId));
          await database.db
            .delete(projectResources)
            .where(eq(projectResources.userId, userId));
          await database.db
            .delete(projects)
            .where(eq(projects.userId, userId));
          await database.db
            .delete(projectWorkspaces)
            .where(eq(projectWorkspaces.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `projects-${crypto.randomUUID()}@example.com`,
        displayName: "Projects DB Test",
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

    const workspace = await service.createWorkspace({
      userId,
      name: "Personal",
      description: "Durable workspace",
    });
    assert.equal(workspace.version, 1);

    const project = await service.createProject({
      userId,
      workspaceId: workspace.id,
      name: "LeileiOS",
      description: "Runtime project",
    });
    assert.equal(project.workspaceId, workspace.id);
    assert.equal(project.version, 1);

    const file = await service.createResource({
      userId,
      projectId: project.id,
      kind: "file",
      key: "docs/index.md",
      title: "Index",
      content: "# Project",
      metadata: { mime_type: "text/markdown" },
    });
    const instructions = await service.createResource({
      userId,
      projectId: project.id,
      kind: "instructions",
      key: "default",
      content: "Use project context.",
    });
    assert.equal(file.version, 1);
    assert.equal(instructions.kind, "instructions");

    const listedFiles = await service.listResources({
      userId,
      projectId: project.id,
      kind: "file",
    });
    assert.equal(listedFiles.length, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(listedFiles[0]!, "content"),
      false,
      "resource collection reads must not return file bodies",
    );
    assert.equal(
      (
        await service.getResource({
          userId,
          projectId: project.id,
          resourceId: file.id,
        })
      ).content,
      "# Project",
    );

    const updatedFile = await service.updateResource({
      userId,
      projectId: project.id,
      resourceId: file.id,
      expectedVersion: file.version,
      content: "# Project\n\nUpdated",
    });
    assert.equal(updatedFile.version, 2);

    await assert.rejects(
      service.updateResource({
        userId,
        projectId: project.id,
        resourceId: file.id,
        expectedVersion: 1,
        title: "stale write",
      }),
      (error: unknown) =>
        error instanceof ProjectWorkspaceServiceError
        && error.code === "VERSION_CONFLICT",
    );

    const conversation = await conversationService.createConversation({
      userId,
      title: "Project conversation",
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
        providerSessionId: "projects-test-session",
      },
    });

    assert.deepEqual(
      await service.attachConversation({
        userId,
        projectId: project.id,
        conversationId: conversation.id,
      }),
      { applied: true },
    );
    assert.deepEqual(
      await service.attachConversation({
        userId,
        projectId: project.id,
        conversationId: conversation.id,
      }),
      { applied: false },
    );

    const projectConversationsView =
      await service.listProjectConversations({
        userId,
        projectId: project.id,
      });
    assert.deepEqual(projectConversationsView, [{
      conversationId: conversation.id,
      title: "Project conversation",
      lifecycleStatus: "active",
      currentHeadMessageId: assistant.message.id,
      lastMessageAt: assistant.message.createdAt,
      addedAt: projectConversationsView[0]!.addedAt,
    }]);

    await service.deleteProject({
      userId,
      projectId: project.id,
      expectedVersion: project.version,
    });

    assert.equal(
      await conversationService.getConversation({
        userId,
        conversationId: conversation.id,
      }) !== null,
      true,
      "deleting a Project must not delete canonical conversation history",
    );
    assert.equal(
      (
        await database.db
          .select({ conversationId: projectConversations.conversationId })
          .from(projectConversations)
          .where(eq(projectConversations.projectId, project.id))
      ).length,
      0,
      "Project deletion must cascade only the membership relation",
    );

    const project2 = await service.createProject({
      userId,
      workspaceId: workspace.id,
      name: "Second",
    });
    await service.attachConversation({
      userId,
      projectId: project2.id,
      conversationId: conversation.id,
    });

    assert.equal(
      (
        await database.db
          .select({ conversationId: projectConversations.conversationId })
          .from(projectConversations)
          .where(and(
            eq(projectConversations.projectId, project2.id),
            eq(projectConversations.conversationId, conversation.id),
          ))
      ).length,
      1,
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
    assert.equal(
      (
        await database.db
          .select({ conversationId: projectConversations.conversationId })
          .from(projectConversations)
          .where(eq(projectConversations.projectId, project2.id))
      ).length,
      0,
      "canonical conversation deletion must cascade stale Project membership",
    );

    const secondWorkspace = await service.createWorkspace({
      userId,
      name: "Throwaway",
    });
    const secondProject = await service.createProject({
      userId,
      workspaceId: secondWorkspace.id,
      name: "Cascade test",
    });
    await service.createResource({
      userId,
      projectId: secondProject.id,
      kind: "settings",
      key: "default",
      content: "{}",
    });

    await service.deleteWorkspace({
      userId,
      workspaceId: secondWorkspace.id,
      expectedVersion: secondWorkspace.version,
    });

    assert.equal(
      (
        await database.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, secondWorkspace.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await database.db
          .select({ id: projectResources.id })
          .from(projectResources)
          .where(eq(projectResources.projectId, secondProject.id))
      ).length,
      0,
    );
  },
);


test(
  "single-layer Workspace product maps one public id to execution authority and hides backing containers",
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
            .delete(projectConversations)
            .where(eq(projectConversations.userId, userId));
          await database.db
            .delete(projectResources)
            .where(eq(projectResources.userId, userId));
          await database.db
            .delete(projects)
            .where(eq(projects.userId, userId));
          await database.db
            .delete(projectWorkspaces)
            .where(eq(projectWorkspaces.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `workspaces-${crypto.randomUUID()}@example.com`,
        displayName: "Workspace Product Test",
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
      description: "single public layer",
    });
    assert.equal(workspace.version, 1);

    const [executionRow] = await database.db
      .select({
        id: projects.id,
        backingId: projects.workspaceId,
        name: projects.name,
      })
      .from(projects)
      .where(and(
        eq(projects.userId, userId),
        eq(projects.id, workspace.id),
      ));
    assert.ok(executionRow);
    assert.equal(executionRow.id, workspace.id);
    assert.equal(executionRow.name, "LeileiOS");

    const backingRows = await database.db
      .select({
        id: projectWorkspaces.id,
        name: projectWorkspaces.name,
      })
      .from(projectWorkspaces)
      .where(and(
        eq(projectWorkspaces.userId, userId),
        eq(projectWorkspaces.id, executionRow.backingId),
      ));
    assert.deepEqual(backingRows, [{
      id: executionRow.backingId,
      name: "LeileiOS",
    }]);

    assert.deepEqual(
      await service.listProductWorkspaces({ userId }),
      [workspace],
    );
    assert.equal(
      (await service.getProductWorkspace({
        userId,
        workspaceId: workspace.id,
      })).id,
      workspace.id,
    );

    const resource = await service.createWorkspaceResource({
      userId,
      workspaceId: workspace.id,
      kind: "instructions",
      key: "default",
      content: "Use the real Workspace.",
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
    await service.attachWorkspaceConversation({
      userId,
      workspaceId: workspace.id,
      conversationId: conversation.id,
    });
    assert.deepEqual(
      (await service.listProductWorkspaces({
        userId,
        conversationId: conversation.id,
      })).map((row) => row.id),
      [workspace.id],
    );

    await service.deleteProductWorkspace({
      userId,
      workspaceId: workspace.id,
      expectedVersion: workspace.version,
    });

    assert.equal(
      (await database.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, workspace.id))).length,
      0,
    );
    assert.equal(
      (await database.db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.id, executionRow.backingId))).length,
      0,
      "product-created backing container must disappear with its last execution Workspace",
    );
    assert.ok(
      await conversationService.getConversation({
        userId,
        conversationId: conversation.id,
      }),
      "Workspace deletion must preserve canonical Conversation history",
    );

    const legacyBacking = await service.createWorkspace({
      userId,
      name: "Legacy backing",
    });
    const first = await service.createProject({
      userId,
      workspaceId: legacyBacking.id,
      name: "First",
    });
    const sibling = await service.createProject({
      userId,
      workspaceId: legacyBacking.id,
      name: "Sibling",
    });

    await service.deleteProductWorkspace({
      userId,
      workspaceId: first.id,
      expectedVersion: first.version,
    });

    assert.ok(
      (await database.db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.id, legacyBacking.id)))[0],
      "legacy backing container must survive while another execution Workspace uses it",
    );
    assert.ok(
      (await database.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, sibling.id)))[0],
    );
  },
);


test(
  "single-layer Workspace deletion fails closed while canonical provider checkpoints still depend on it",
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
            .delete(projectConversations)
            .where(eq(projectConversations.userId, userId));
          await database.db
            .delete(projectResources)
            .where(eq(projectResources.userId, userId));
          await database.db
            .delete(projects)
            .where(eq(projects.userId, userId));
          await database.db
            .delete(projectWorkspaces)
            .where(eq(projectWorkspaces.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `workspace-in-use-${crypto.randomUUID()}@example.com`,
        displayName: "Workspace In Use Test",
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
      "failed delete must leave Workspace intact",
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
