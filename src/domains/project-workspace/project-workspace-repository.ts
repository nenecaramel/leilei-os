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
  conversationProviderSessionCheckpoints,
  conversations,
  nativeLiveProviderSessionEntries,
  nativeLiveProviderSessionStoreStatus,
  projectConversations,
  projectResources,
  projects,
  projectWorkspaces,
  users,
  type ProjectResourceKind,
} from "../../database/schema.js";
import {
  lockAndReadProductCreateIdempotency,
  recordProductCreateIdempotency,
} from "../product-write/product-create-idempotency.js";
import type {
  CreateProductWorkspaceOutcome,
  CreateResourceOutcome,
  CreateWorkspaceResourceOutcome,
  DeleteMutationOutcome,
  DeleteProductWorkspaceOutcome,
  ProjectConversation,
  ProjectConversationMutationOutcome,
  ProjectResource,
  ProjectResourceSummary,
  ProjectSummary,
  ProductWorkspace,
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

  async listProductWorkspaces(input: {
    userId: string;
    conversationId?: string;
  }): Promise<ProductWorkspace[]> {
    if (input.conversationId) {
      const rows = await this.db
        .select(projectSelection())
        .from(projectConversations)
        .innerJoin(
          projects,
          and(
            eq(projectConversations.projectId, projects.id),
            eq(projectConversations.userId, projects.userId),
          ),
        )
        .where(and(
          eq(projectConversations.userId, input.userId),
          eq(
            projectConversations.conversationId,
            input.conversationId,
          ),
        ))
        .orderBy(desc(projects.updatedAt), desc(projects.id));
      return rows.map(mapProductWorkspace);
    }

    const rows = await this.db
      .select(projectSelection())
      .from(projects)
      .where(eq(projects.userId, input.userId))
      .orderBy(desc(projects.updatedAt), desc(projects.id));
    return rows.map(mapProductWorkspace);
  }

  async getProductWorkspace(input: {
    userId: string;
    workspaceId: string;
  }): Promise<ProductWorkspace | null> {
    const [row] = await this.db
      .select(projectSelection())
      .from(projects)
      .where(and(
        eq(projects.userId, input.userId),
        eq(projects.id, input.workspaceId),
      ))
      .limit(1);
    return row ? mapProductWorkspace(row) : null;
  }

  async createProductWorkspace(input: {
    userId: string;
    name: string;
    description: string | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CreateProductWorkspaceOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const receipt = await lockAndReadProductCreateIdempotency(
          transaction,
          {
            userId: input.userId,
            operation: "workspace_create",
            idempotencyKey: input.idempotencyKey,
          },
        );
        if (receipt) {
          if (receipt.requestHash !== input.requestHash) {
            return { outcome: "idempotency_conflict" as const };
          }
          return {
            outcome: "committed" as const,
            value:
              receipt.response as unknown as ProductWorkspace,
          };
        }

        const [backing] = await transaction
          .insert(projectWorkspaces)
          .values({
            userId: input.userId,
            name: input.name,
            description: input.description,
          })
          .returning({ id: projectWorkspaces.id });
        if (!backing) {
          throw new Error("Workspace backing insert failed.");
        }

        const [row] = await transaction
          .insert(projects)
          .values({
            userId: input.userId,
            workspaceId: backing.id,
            name: input.name,
            description: input.description,
          })
          .returning(projectSelection());
        if (!row) throw new Error("Workspace insert failed.");

        const value = mapProductWorkspace(row);
        await recordProductCreateIdempotency(transaction, {
          userId: input.userId,
          operation: "workspace_create",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          resourceType: "workspace",
          resourceId: value.id,
          response: value as unknown as Record<string, unknown>,
        });
        return { outcome: "committed" as const, value };
      },
      { isolationLevel: "serializable" },
    );
  }

  async updateProductWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProductWorkspace>> {
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
        eq(projects.id, input.workspaceId),
        eq(projects.version, input.expectedVersion),
      ))
      .returning(projectSelection());
    if (row) {
      return {
        outcome: "committed",
        value: mapProductWorkspace(row),
      };
    }

    const [existing] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(
        eq(projects.userId, input.userId),
        eq(projects.id, input.workspaceId),
      ))
      .limit(1);
    return existing
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  async deleteProductWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<DeleteProductWorkspaceOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [existing] = await transaction
          .select({
            id: projects.id,
            backingWorkspaceId: projects.workspaceId,
            version: projects.version,
          })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!existing) return { outcome: "not_found" as const };
        if (existing.version !== input.expectedVersion) {
          return { outcome: "version_conflict" as const };
        }

        const [checkpoint] = await transaction
          .select({ id: conversationProviderSessionCheckpoints.id })
          .from(conversationProviderSessionCheckpoints)
          .where(and(
            eq(
              conversationProviderSessionCheckpoints.userId,
              input.userId,
            ),
            eq(
              conversationProviderSessionCheckpoints.workspaceId,
              input.workspaceId,
            ),
          ))
          .limit(1);
        if (checkpoint) {
          return { outcome: "workspace_in_use" as const };
        }

        await transaction
          .delete(nativeLiveProviderSessionEntries)
          .where(and(
            eq(nativeLiveProviderSessionEntries.userId, input.userId),
            eq(
              nativeLiveProviderSessionEntries.workspaceId,
              input.workspaceId,
            ),
          ));
        await transaction
          .delete(nativeLiveProviderSessionStoreStatus)
          .where(and(
            eq(nativeLiveProviderSessionStoreStatus.userId, input.userId),
            eq(
              nativeLiveProviderSessionStoreStatus.workspaceId,
              input.workspaceId,
            ),
          ));

        await transaction
          .delete(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.workspaceId),
          ));

        const [sibling] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.workspaceId, existing.backingWorkspaceId),
          ))
          .limit(1);
        if (!sibling) {
          await transaction
            .delete(projectWorkspaces)
            .where(and(
              eq(projectWorkspaces.userId, input.userId),
              eq(projectWorkspaces.id, existing.backingWorkspaceId),
            ));
        }
        return { outcome: "deleted" as const };
      },
      { isolationLevel: "serializable" },
    );
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
    conversationId?: string;
  }): Promise<ProjectSummary[]> {
    if (input.conversationId) {
      const rows = await this.db
        .select(projectSelection())
        .from(projectConversations)
        .innerJoin(
          projects,
          and(
            eq(projectConversations.projectId, projects.id),
            eq(projectConversations.userId, projects.userId),
          ),
        )
        .where(and(
          eq(projectConversations.userId, input.userId),
          eq(
            projectConversations.conversationId,
            input.conversationId,
          ),
          ...(input.workspaceId
            ? [eq(projects.workspaceId, input.workspaceId)]
            : []),
        ))
        .orderBy(desc(projects.updatedAt), desc(projects.id));
      return rows.map(mapProject);
    }

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
  }): Promise<ProjectResourceSummary[] | null> {
    if (!await this.projectExists(input.userId, input.projectId)) {
      return null;
    }
    const rows = await this.db
      .select(resourceSummarySelection())
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
    return rows.map(mapResourceSummary);
  }

  async getResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
  }): Promise<ProjectResource | null> {
    const [row] = await this.db
      .select(resourceSelection())
      .from(projectResources)
      .where(and(
        eq(projectResources.userId, input.userId),
        eq(projectResources.projectId, input.projectId),
        eq(projectResources.id, input.resourceId),
      ))
      .limit(1);
    return row ? mapResource(row) : null;
  }

  async createWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    kind: ProjectResourceKind;
    key: string;
    title: string | null;
    content: string | null;
    metadata: Record<string, unknown>;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CreateWorkspaceResourceOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const receipt = await lockAndReadProductCreateIdempotency(
          transaction,
          {
            userId: input.userId,
            operation: "workspace_resource_create",
            idempotencyKey: input.idempotencyKey,
          },
        );
        if (receipt) {
          if (receipt.requestHash !== input.requestHash) {
            return { outcome: "idempotency_conflict" as const };
          }
          return {
            outcome: "committed" as const,
            value:
              receipt.response as unknown as ProjectResource,
          };
        }

        const [workspace] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(
            eq(projects.userId, input.userId),
            eq(projects.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!workspace) {
          return { outcome: "workspace_not_found" as const };
        }

        const [existing] = await transaction
          .select({ id: projectResources.id })
          .from(projectResources)
          .where(and(
            eq(projectResources.projectId, input.workspaceId),
            eq(projectResources.kind, input.kind),
            eq(projectResources.resourceKey, input.key),
          ))
          .limit(1);
        if (existing) {
          return { outcome: "resource_conflict" as const };
        }

        const [row] = await transaction
          .insert(projectResources)
          .values({
            userId: input.userId,
            projectId: input.workspaceId,
            kind: input.kind,
            resourceKey: input.key,
            title: input.title,
            content: input.content,
            metadata: input.metadata,
          })
          .returning(resourceSelection());
        if (!row) throw new Error("Workspace resource insert failed.");

        const value = mapResource(row);
        await recordProductCreateIdempotency(transaction, {
          userId: input.userId,
          operation: "workspace_resource_create",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          resourceType: "workspace_resource",
          resourceId: value.id,
          response: value as unknown as Record<string, unknown>,
        });
        return { outcome: "committed" as const, value };
      },
      { isolationLevel: "serializable" },
    );
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

function resourceSummarySelection() {
  return {
    id: projectResources.id,
    projectId: projectResources.projectId,
    kind: projectResources.kind,
    resourceKey: projectResources.resourceKey,
    title: projectResources.title,
    metadata: projectResources.metadata,
    version: projectResources.version,
    createdAt: projectResources.createdAt,
    updatedAt: projectResources.updatedAt,
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

function mapProductWorkspace(
  row: ReturnType<typeof projectRowShape>,
): ProductWorkspace {
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

function mapResourceSummary(
  row: ReturnType<typeof resourceSummaryRowShape>,
): ProjectResourceSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    key: row.resourceKey,
    title: row.title,
    metadata: row.metadata,
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

function resourceSummaryRowShape() {
  return {
    id: "",
    projectId: "",
    kind: "file" as ProjectResourceKind,
    resourceKey: "",
    title: null as string | null,
    metadata: {} as Record<string, unknown>,
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
