import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationMessages,
  conversations,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  users,
  type ProjectResourceKind,
} from "../../database/schema.js";
import type {
  CreateResourceOutcome,
  DeleteMutationOutcome,
  ProjectConversation,
  ProjectConversationMutationOutcome,
  ProjectResource,
  ProjectSummary,
  ProjectWorkspace,
  ProjectWorkspaceRepository,
  VersionedMutationOutcome,
} from "./project-workspace-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

export class DrizzleProjectWorkspaceRepository
implements ProjectWorkspaceRepository {
  constructor(private readonly db: Database) {}

  async findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  async listWorkspaces(userId: string): Promise<ProjectWorkspace[]> {
    const rows = await this.db
      .select(workspaceSelection())
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.userId, userId))
      .orderBy(
        desc(projectWorkspaces.updatedAt),
        desc(projectWorkspaces.id),
      );
    return rows.map(mapWorkspace);
  }

  async createWorkspace(input: {
    userId: string;
    name: string;
    description: string | null;
  }): Promise<ProjectWorkspace> {
    const [row] = await this.db
      .insert(projectWorkspaces)
      .values({
        userId: input.userId,
        name: input.name,
        description: input.description,
      })
      .returning(workspaceSelection());
    if (!row) throw new Error("Workspace insert failed.");
    return mapWorkspace(row);
  }

  async updateWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProjectWorkspace>> {
    const [row] = await this.db
      .update(projectWorkspaces)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        version: sql`${projectWorkspaces.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(projectWorkspaces.userId, input.userId),
        eq(projectWorkspaces.id, input.workspaceId),
        eq(projectWorkspaces.version, input.expectedVersion),
      ))
      .returning(workspaceSelection());
    if (row) {
      return { outcome: "committed", value: mapWorkspace(row) };
    }
    return await this.workspaceMiss(input.userId, input.workspaceId);
  }

  async deleteWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome> {
    const deleted = await this.db
      .delete(projectWorkspaces)
      .where(and(
        eq(projectWorkspaces.userId, input.userId),
        eq(projectWorkspaces.id, input.workspaceId),
        eq(projectWorkspaces.version, input.expectedVersion),
      ))
      .returning({ id: projectWorkspaces.id });
    if (deleted.length === 1) return { outcome: "deleted" };
    return await this.workspaceMiss(input.userId, input.workspaceId);
  }

  async listProjects(input: {
    userId: string;
    workspaceId?: string;
  }): Promise<ProjectSummary[]> {
    const rows = await this.db
      .select(projectSelection())
      .from(projects)
      .where(and(
        eq(projects.userId, input.userId),
        ...(input.workspaceId
          ? [eq(projects.workspaceId, input.workspaceId)]
          : []),
      ))
      .orderBy(desc(projects.updatedAt), desc(projects.id));
    return rows.map(mapProject);
  }

  async getProject(input: {
    userId: string;
    projectId: string;
  }): Promise<ProjectSummary | null> {
    const [row] = await this.db
      .select(projectSelection())
      .from(projects)
      .where(and(
        eq(projects.userId, input.userId),
        eq(projects.id, input.projectId),
      ))
      .limit(1);
    return row ? mapProject(row) : null;
  }

  async createProject(input: {
    userId: string;
    workspaceId: string;
    name: string;
    description: string | null;
  }): Promise<
    | { outcome: "committed"; value: ProjectSummary }
    | { outcome: "workspace_not_found" }
  > {
    return this.db.transaction(
      async (transaction) => {
        const [workspace] = await transaction
          .select({ id: projectWorkspaces.id })
          .from(projectWorkspaces)
          .where(and(
            eq(projectWorkspaces.userId, input.userId),
            eq(projectWorkspaces.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!workspace) return { outcome: "workspace_not_found" as const };

        const [row] = await transaction
          .insert(projects)
          .values({
            userId: input.userId,
            workspaceId: input.workspaceId,
            name: input.name,
            description: input.description,
          })
          .returning(projectSelection());
        if (!row) throw new Error("Project insert failed.");
        return {
          outcome: "committed" as const,
          value: mapProject(row),
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async updateProject(input: {
    userId: string;
    projectId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProjectSummary>> {
    const [row] = await this.db
      .update(projects)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        version: sql`${projects.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(projects.userId, input.userId),
        eq(projects.id, input.projectId),
        eq(projects.version, input.expectedVersion),
      ))
      .returning(projectSelection());
    if (row) return { outcome: "committed", value: mapProject(row) };
    return await this.projectMiss(input.userId, input.projectId);
  }

  async deleteProject(input: {
    userId: string;
    projectId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome> {
    const deleted = await this.db
      .delete(projects)
      .where(and(
        eq(projects.userId, input.userId),
        eq(projects.id, input.projectId),
        eq(projects.version, input.expectedVersion),
      ))
      .returning({ id: projects.id });
    if (deleted.length === 1) return { outcome: "deleted" };
    return await this.projectMiss(input.userId, input.projectId);
  }

  async listResources(input: {
    userId: string;
    projectId: string;
    kind?: ProjectResourceKind;
  }): Promise<ProjectResource[] | null> {
    if (!await this.projectExists(input.userId, input.projectId)) {
      return null;
    }
    const rows = await this.db
      .select(resourceSelection())
      .from(projectResources)
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        ...(input.kind ? [eq(projectResources.kind, input.kind)] : []),
      ))
      .orderBy(
        asc(projectResources.kind),
        asc(projectResources.resourceKey),
        asc(projectResources.id),
      );
    return rows.map(mapResource);
  }

  async createResource(input: {
    userId: string;
    projectId: string;
    kind: ProjectResourceKind;
    key: string;
    title: string | null;
    content: string | null;
    metadata: Record<string, unknown>;
  }): Promise<CreateResourceOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.projectId),
          ))
          .for("update")
          .limit(1);
        if (!project) return { outcome: "project_not_found" as const };

        const [existing] = await transaction
          .select({ id: projectResources.id })
          .from(projectResources)
          .where(and(
            eq(projectResources.projectId, input.projectId),
            eq(projectResources.kind, input.kind),
            eq(projectResources.resourceKey, input.key),
          ))
          .limit(1);
        if (existing) return { outcome: "resource_conflict" as const };

        const [row] = await transaction
          .insert(projectResources)
          .values({
            userId: input.userId,
            projectId: input.projectId,
            kind: input.kind,
            resourceKey: input.key,
            title: input.title,
            content: input.content,
            metadata: input.metadata,
          })
          .returning(resourceSelection());
        if (!row) throw new Error("Project resource insert failed.");
        return {
          outcome: "committed" as const,
          value: mapResource(row),
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async updateResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
    expectedVersion: number;
    title?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VersionedMutationOutcome<ProjectResource>> {
    const [row] = await this.db
      .update(projectResources)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        version: sql`${projectResources.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        eq(projectResources.id, input.resourceId),
        eq(projectResources.version, input.expectedVersion),
      ))
      .returning(resourceSelection());
    if (row) return { outcome: "committed", value: mapResource(row) };

    const [existing] = await this.db
      .select({ id: projectResources.id })
      .from(projectResources)
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        eq(projectResources.id, input.resourceId),
      ))
      .limit(1);
    return existing
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  async deleteResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome> {
    const deleted = await this.db
      .delete(projectResources)
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        eq(projectResources.id, input.resourceId),
        eq(projectResources.version, input.expectedVersion),
      ))
      .returning({ id: projectResources.id });
    if (deleted.length === 1) return { outcome: "deleted" };

    const [existing] = await this.db
      .select({ id: projectResources.id })
      .from(projectResources)
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        eq(projectResources.id, input.resourceId),
      ))
      .limit(1);
    return existing
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  async listProjectConversations(input: {
    userId: string;
    projectId: string;
  }): Promise<ProjectConversation[] | null> {
    if (!await this.projectExists(input.userId, input.projectId)) {
      return null;
    }
    const rows = await this.db
      .select({
        conversationId: conversations.id,
        title: conversations.title,
        lifecycleStatus: conversations.lifecycleStatus,
        currentHeadMessageId: conversations.currentHeadMessageId,
        lastMessageAt: conversationMessages.createdAt,
        addedAt: projectConversations.addedAt,
      })
      .from(projectConversations)
      .innerJoin(
        conversations,
        and(
          eq(projectConversations.conversationId, conversations.id),
          eq(projectConversations.userId, conversations.userId),
        ),
      )
      .leftJoin(
        conversationMessages,
        and(
          eq(conversations.currentHeadMessageId, conversationMessages.id),
          eq(conversations.id, conversationMessages.conversationId),
          eq(conversations.userId, conversationMessages.userId),
        ),
      )
      .where(and(
        eq(projectConversations.userId, input.userId),
        eq(projectConversations.projectId, input.projectId),
        eq(conversations.origin, "native_live"),
        inArray(conversations.lifecycleStatus, ["active", "archived"]),
      ))
      .orderBy(
        desc(projectConversations.addedAt),
        desc(conversations.id),
      );

    return rows.map((row) => ({
      conversationId: row.conversationId,
      title: row.title,
      lifecycleStatus: row.lifecycleStatus,
      currentHeadMessageId: row.currentHeadMessageId,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      addedAt: row.addedAt.toISOString(),
    }));
  }

  async attachConversation(input: {
    userId: string;
    projectId: string;
    conversationId: string;
  }): Promise<ProjectConversationMutationOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.projectId),
          ))
          .for("update")
          .limit(1);
        if (!project) return { outcome: "project_not_found" as const };

        const [conversation] = await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
            inArray(conversations.lifecycleStatus, ["active", "archived"]),
          ))
          .limit(1);
        if (!conversation) {
          return { outcome: "conversation_not_found" as const };
        }

        const inserted = await transaction
          .insert(projectConversations)
          .values({
            userId: input.userId,
            projectId: input.projectId,
            conversationId: input.conversationId,
          })
          .onConflictDoNothing()
          .returning({ conversationId: projectConversations.conversationId });

        return inserted.length === 1
          ? { outcome: "committed" as const }
          : { outcome: "already_applied" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  async detachConversation(input: {
    userId: string;
    projectId: string;
    conversationId: string;
  }): Promise<ProjectConversationMutationOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.projectId),
          ))
          .for("update")
          .limit(1);
        if (!project) return { outcome: "project_not_found" as const };

        const deleted = await transaction
          .delete(projectConversations)
          .where(and(
            eq(projectConversations.userId, input.userId),
            eq(projectConversations.projectId, input.projectId),
            eq(projectConversations.conversationId, input.conversationId),
          ))
          .returning({ conversationId: projectConversations.conversationId });

        return deleted.length === 1
          ? { outcome: "committed" as const }
          : { outcome: "already_applied" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  private async projectExists(
    userId: string,
    projectId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.id, projectId)))
      .limit(1);
    return Boolean(row);
  }

  private async workspaceMiss(
    userId: string,
    workspaceId: string,
  ): Promise<{ outcome: "not_found" | "version_conflict" }> {
    const [row] = await this.db
      .select({ id: projectWorkspaces.id })
      .from(projectWorkspaces)
      .where(and(
        eq(projectWorkspaces.userId, userId),
        eq(projectWorkspaces.id, workspaceId),
      ))
      .limit(1);
    return row
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  private async projectMiss(
    userId: string,
    projectId: string,
  ): Promise<{ outcome: "not_found" | "version_conflict" }> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.id, projectId)))
      .limit(1);
    return row
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }
}

function workspaceSelection() {
  return {
    id: projectWorkspaces.id,
    name: projectWorkspaces.name,
    description: projectWorkspaces.description,
    version: projectWorkspaces.version,
    createdAt: projectWorkspaces.createdAt,
    updatedAt: projectWorkspaces.updatedAt,
  };
}

function projectSelection() {
  return {
    id: projects.id,
    workspaceId: projects.workspaceId,
    name: projects.name,
    description: projects.description,
    version: projects.version,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  };
}

function resourceSelection() {
  return {
    id: projectResources.id,
    projectId: projectResources.projectId,
    kind: projectResources.kind,
    resourceKey: projectResources.resourceKey,
    title: projectResources.title,
    content: projectResources.content,
    metadata: projectResources.metadata,
    version: projectResources.version,
    createdAt: projectResources.createdAt,
    updatedAt: projectResources.updatedAt,
  };
}

function mapWorkspace(row: ReturnType<typeof workspaceRowShape>): ProjectWorkspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapProject(row: ReturnType<typeof projectRowShape>): ProjectSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapResource(row: ReturnType<typeof resourceRowShape>): ProjectResource {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    key: row.resourceKey,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Type helpers keep the row mappers independent of Drizzle query-builder
// internals while still checking every projected field.
function workspaceRowShape() {
  return {
    id: "",
    name: "",
    description: null as string | null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function projectRowShape() {
  return {
    id: "",
    workspaceId: "",
    name: "",
    description: null as string | null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function resourceRowShape() {
  return {
    id: "",
    projectId: "",
    kind: "file" as ProjectResourceKind,
    resourceKey: "",
    title: null as string | null,
    content: null as string | null,
    metadata: {} as Record<string, unknown>,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
