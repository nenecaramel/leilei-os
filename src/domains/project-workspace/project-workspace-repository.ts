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
  users,
  workspaceConversations,
  workspaceResources,
  workspaces,
  type ProjectResourceKind,
} from "../../database/schema.js";
import {
  lockAndReadProductCreateIdempotency,
  recordProductCreateIdempotency,
} from "../product-write/product-create-idempotency.js";
import type {
  CreateProductWorkspaceOutcome,
  CreateWorkspaceResourceOutcome,
  DeleteMutationOutcome,
  DeleteProductWorkspaceOutcome,
  ProductWorkspace,
  ProjectWorkspaceRepository,
  VersionedMutationOutcome,
  WorkspaceConversation,
  WorkspaceConversationMutationOutcome,
  WorkspaceResource,
  WorkspaceResourceSummary,
} from "./project-workspace-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

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
        .select(workspaceSelection())
        .from(workspaceConversations)
        .innerJoin(
          workspaces,
          and(
            eq(workspaceConversations.workspaceId, workspaces.id),
            eq(workspaceConversations.userId, workspaces.userId),
          ),
        )
        .where(and(
          eq(workspaceConversations.userId, input.userId),
          eq(
            workspaceConversations.conversationId,
            input.conversationId,
          ),
        ))
        .orderBy(desc(workspaces.updatedAt), desc(workspaces.id));
      return rows.map(mapWorkspace);
    }

    const rows = await this.db
      .select(workspaceSelection())
      .from(workspaces)
      .where(eq(workspaces.userId, input.userId))
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id));
    return rows.map(mapWorkspace);
  }

  async getProductWorkspace(input: {
    userId: string;
    workspaceId: string;
  }): Promise<ProductWorkspace | null> {
    const [row] = await this.db
      .select(workspaceSelection())
      .from(workspaces)
      .where(and(
        eq(workspaces.userId, input.userId),
        eq(workspaces.id, input.workspaceId),
      ))
      .limit(1);
    return row ? mapWorkspace(row) : null;
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
            value: receipt.response as unknown as ProductWorkspace,
          };
        }

        const [row] = await transaction
          .insert(workspaces)
          .values({
            userId: input.userId,
            name: input.name,
            description: input.description,
          })
          .returning(workspaceSelection());
        if (!row) throw new Error("Workspace insert failed.");

        const value = mapWorkspace(row);
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
      .update(workspaces)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        version: sql`${workspaces.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(workspaces.userId, input.userId),
        eq(workspaces.id, input.workspaceId),
        eq(workspaces.version, input.expectedVersion),
      ))
      .returning(workspaceSelection());
    if (row) {
      return { outcome: "committed", value: mapWorkspace(row) };
    }
    return await this.workspaceMiss(input.userId, input.workspaceId);
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
            id: workspaces.id,
            version: workspaces.version,
          })
          .from(workspaces)
          .where(and(
            eq(workspaces.userId, input.userId),
            eq(workspaces.id, input.workspaceId),
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
          .delete(workspaces)
          .where(and(
            eq(workspaces.userId, input.userId),
            eq(workspaces.id, input.workspaceId),
          ));
        return { outcome: "deleted" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  async listWorkspaceResources(input: {
    userId: string;
    workspaceId: string;
    kind?: ProjectResourceKind;
  }): Promise<WorkspaceResourceSummary[] | null> {
    if (!await this.workspaceExists(input.userId, input.workspaceId)) {
      return null;
    }
    const rows = await this.db
      .select(resourceSummarySelection())
      .from(workspaceResources)
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        ...(input.kind
          ? [eq(workspaceResources.kind, input.kind)]
          : []),
      ))
      .orderBy(
        asc(workspaceResources.kind),
        asc(workspaceResources.resourceKey),
        asc(workspaceResources.id),
      );
    return rows.map(mapResourceSummary);
  }

  async getWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
  }): Promise<WorkspaceResource | null> {
    const [row] = await this.db
      .select(resourceSelection())
      .from(workspaceResources)
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        eq(workspaceResources.id, input.resourceId),
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
            value: receipt.response as unknown as WorkspaceResource,
          };
        }

        const [workspace] = await transaction
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(
            eq(workspaces.userId, input.userId),
            eq(workspaces.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!workspace) {
          return { outcome: "workspace_not_found" as const };
        }

        const [existing] = await transaction
          .select({ id: workspaceResources.id })
          .from(workspaceResources)
          .where(and(
            eq(workspaceResources.workspaceId, input.workspaceId),
            eq(workspaceResources.kind, input.kind),
            eq(workspaceResources.resourceKey, input.key),
          ))
          .limit(1);
        if (existing) {
          return { outcome: "resource_conflict" as const };
        }

        const [row] = await transaction
          .insert(workspaceResources)
          .values({
            userId: input.userId,
            workspaceId: input.workspaceId,
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

  async updateWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
    expectedVersion: number;
    title?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VersionedMutationOutcome<WorkspaceResource>> {
    const [row] = await this.db
      .update(workspaceResources)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        version: sql`${workspaceResources.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        eq(workspaceResources.id, input.resourceId),
        eq(workspaceResources.version, input.expectedVersion),
      ))
      .returning(resourceSelection());
    if (row) return { outcome: "committed", value: mapResource(row) };

    const [existing] = await this.db
      .select({ id: workspaceResources.id })
      .from(workspaceResources)
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        eq(workspaceResources.id, input.resourceId),
      ))
      .limit(1);
    return existing
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  async deleteWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome> {
    const deleted = await this.db
      .delete(workspaceResources)
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        eq(workspaceResources.id, input.resourceId),
        eq(workspaceResources.version, input.expectedVersion),
      ))
      .returning({ id: workspaceResources.id });
    if (deleted.length === 1) return { outcome: "deleted" };

    const [existing] = await this.db
      .select({ id: workspaceResources.id })
      .from(workspaceResources)
      .where(and(
        eq(workspaceResources.userId, input.userId),
        eq(workspaceResources.workspaceId, input.workspaceId),
        eq(workspaceResources.id, input.resourceId),
      ))
      .limit(1);
    return existing
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }

  async listWorkspaceConversations(input: {
    userId: string;
    workspaceId: string;
  }): Promise<WorkspaceConversation[] | null> {
    if (!await this.workspaceExists(input.userId, input.workspaceId)) {
      return null;
    }
    const rows = await this.db
      .select({
        conversationId: conversations.id,
        title: conversations.title,
        lifecycleStatus: conversations.lifecycleStatus,
        currentHeadMessageId: conversations.currentHeadMessageId,
        lastMessageAt: conversationMessages.createdAt,
        addedAt: workspaceConversations.addedAt,
      })
      .from(workspaceConversations)
      .innerJoin(
        conversations,
        and(
          eq(workspaceConversations.conversationId, conversations.id),
          eq(workspaceConversations.userId, conversations.userId),
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
        eq(workspaceConversations.userId, input.userId),
        eq(workspaceConversations.workspaceId, input.workspaceId),
        eq(conversations.origin, "native_live"),
        inArray(conversations.lifecycleStatus, ["active", "archived"]),
      ))
      .orderBy(
        desc(workspaceConversations.addedAt),
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

  async attachWorkspaceConversation(input: {
    userId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<WorkspaceConversationMutationOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [workspace] = await transaction
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(
            eq(workspaces.userId, input.userId),
            eq(workspaces.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!workspace) {
          return { outcome: "workspace_not_found" as const };
        }

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
          .insert(workspaceConversations)
          .values({
            userId: input.userId,
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
          })
          .onConflictDoNothing()
          .returning({
            conversationId: workspaceConversations.conversationId,
          });

        return inserted.length === 1
          ? { outcome: "committed" as const }
          : { outcome: "already_applied" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  async detachWorkspaceConversation(input: {
    userId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<WorkspaceConversationMutationOutcome> {
    return this.db.transaction(
      async (transaction) => {
        const [workspace] = await transaction
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(and(
            eq(workspaces.userId, input.userId),
            eq(workspaces.id, input.workspaceId),
          ))
          .for("update")
          .limit(1);
        if (!workspace) {
          return { outcome: "workspace_not_found" as const };
        }

        const deleted = await transaction
          .delete(workspaceConversations)
          .where(and(
            eq(workspaceConversations.userId, input.userId),
            eq(workspaceConversations.workspaceId, input.workspaceId),
            eq(
              workspaceConversations.conversationId,
              input.conversationId,
            ),
          ))
          .returning({
            conversationId: workspaceConversations.conversationId,
          });

        return deleted.length === 1
          ? { outcome: "committed" as const }
          : { outcome: "already_applied" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  private async workspaceExists(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(
        eq(workspaces.userId, userId),
        eq(workspaces.id, workspaceId),
      ))
      .limit(1);
    return Boolean(row);
  }

  private async workspaceMiss(
    userId: string,
    workspaceId: string,
  ): Promise<{ outcome: "not_found" | "version_conflict" }> {
    return await this.workspaceExists(userId, workspaceId)
      ? { outcome: "version_conflict" }
      : { outcome: "not_found" };
  }
}

function workspaceSelection() {
  return {
    id: workspaces.id,
    name: workspaces.name,
    description: workspaces.description,
    version: workspaces.version,
    createdAt: workspaces.createdAt,
    updatedAt: workspaces.updatedAt,
  };
}

function resourceSummarySelection() {
  return {
    id: workspaceResources.id,
    workspaceId: workspaceResources.workspaceId,
    kind: workspaceResources.kind,
    resourceKey: workspaceResources.resourceKey,
    title: workspaceResources.title,
    metadata: workspaceResources.metadata,
    version: workspaceResources.version,
    createdAt: workspaceResources.createdAt,
    updatedAt: workspaceResources.updatedAt,
  };
}

function resourceSelection() {
  return {
    id: workspaceResources.id,
    workspaceId: workspaceResources.workspaceId,
    kind: workspaceResources.kind,
    resourceKey: workspaceResources.resourceKey,
    title: workspaceResources.title,
    content: workspaceResources.content,
    metadata: workspaceResources.metadata,
    version: workspaceResources.version,
    createdAt: workspaceResources.createdAt,
    updatedAt: workspaceResources.updatedAt,
  };
}

function mapWorkspace(
  row: ReturnType<typeof workspaceRowShape>,
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

function mapResourceSummary(
  row: ReturnType<typeof resourceSummaryRowShape>,
): WorkspaceResourceSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    key: row.resourceKey,
    title: row.title,
    metadata: row.metadata,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapResource(
  row: ReturnType<typeof resourceRowShape>,
): WorkspaceResource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
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

function resourceSummaryRowShape() {
  return {
    id: "",
    workspaceId: "",
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
    workspaceId: "",
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
