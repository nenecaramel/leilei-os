import type {
  ConversationLifecycleStatus,
  ProjectResourceKind,
} from "../../database/schema.js";

export const PROJECT_RESOURCE_KINDS = [
  "file",
  "instructions",
  "settings",
  "skill",
  "agent",
  "mcp",
  "hook",
  "plugin",
] as const satisfies readonly ProjectResourceKind[];

export type ProductWorkspace = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceResourceSummary = {
  id: string;
  workspaceId: string;
  kind: ProjectResourceKind;
  key: string;
  title: string | null;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceResource = WorkspaceResourceSummary & {
  content: string | null;
};

export type WorkspaceConversation = {
  conversationId: string;
  title: string | null;
  lifecycleStatus: ConversationLifecycleStatus;
  currentHeadMessageId: string | null;
  lastMessageAt: string | null;
  addedAt: string;
};

export type VersionedMutationOutcome<T> =
  | { outcome: "committed"; value: T }
  | { outcome: "not_found" }
  | { outcome: "version_conflict" };

export type DeleteMutationOutcome =
  | { outcome: "deleted" }
  | { outcome: "not_found" }
  | { outcome: "version_conflict" };

export type DeleteProductWorkspaceOutcome =
  | DeleteMutationOutcome
  | { outcome: "workspace_in_use" };

export type CreateProductWorkspaceOutcome =
  | { outcome: "committed"; value: ProductWorkspace }
  | { outcome: "idempotency_conflict" };

export type CreateWorkspaceResourceOutcome =
  | { outcome: "committed"; value: WorkspaceResource }
  | { outcome: "workspace_not_found" }
  | { outcome: "resource_conflict" }
  | { outcome: "idempotency_conflict" };

export type WorkspaceConversationMutationOutcome =
  | { outcome: "committed" | "already_applied" }
  | { outcome: "workspace_not_found" }
  | { outcome: "conversation_not_found" };

export interface ProjectWorkspaceRepository {
  findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null>;

  listProductWorkspaces(input: {
    userId: string;
    conversationId?: string;
  }): Promise<ProductWorkspace[]>;

  getProductWorkspace(input: {
    userId: string;
    workspaceId: string;
  }): Promise<ProductWorkspace | null>;

  createProductWorkspace(input: {
    userId: string;
    name: string;
    description: string | null;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CreateProductWorkspaceOutcome>;

  updateProductWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProductWorkspace>>;

  deleteProductWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<DeleteProductWorkspaceOutcome>;

  listWorkspaceResources(input: {
    userId: string;
    workspaceId: string;
    kind?: ProjectResourceKind;
  }): Promise<WorkspaceResourceSummary[] | null>;

  getWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
  }): Promise<WorkspaceResource | null>;

  createWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    kind: ProjectResourceKind;
    key: string;
    title: string | null;
    content: string | null;
    metadata: Record<string, unknown>;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CreateWorkspaceResourceOutcome>;

  updateWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
    expectedVersion: number;
    title?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VersionedMutationOutcome<WorkspaceResource>>;

  deleteWorkspaceResource(input: {
    userId: string;
    workspaceId: string;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome>;

  listWorkspaceConversations(input: {
    userId: string;
    workspaceId: string;
  }): Promise<WorkspaceConversation[] | null>;

  attachWorkspaceConversation(input: {
    userId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<WorkspaceConversationMutationOutcome>;

  detachWorkspaceConversation(input: {
    userId: string;
    workspaceId: string;
    conversationId: string;
  }): Promise<WorkspaceConversationMutationOutcome>;
}
