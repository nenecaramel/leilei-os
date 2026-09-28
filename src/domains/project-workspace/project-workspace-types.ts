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

export type ProjectWorkspace = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectResourceSummary = {
  id: string;
  projectId: string;
  kind: ProjectResourceKind;
  key: string;
  title: string | null;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectResource = ProjectResourceSummary & {
  content: string | null;
};

export type ProjectConversation = {
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

export type CreateResourceOutcome =
  | { outcome: "committed"; value: ProjectResource }
  | { outcome: "project_not_found" }
  | { outcome: "resource_conflict" };

export type ProjectConversationMutationOutcome =
  | { outcome: "committed" | "already_applied" }
  | { outcome: "project_not_found" }
  | { outcome: "conversation_not_found" };

export interface ProjectWorkspaceRepository {
  findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null>;

  listWorkspaces(userId: string): Promise<ProjectWorkspace[]>;

  createWorkspace(input: {
    userId: string;
    name: string;
    description: string | null;
  }): Promise<ProjectWorkspace>;

  updateWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProjectWorkspace>>;

  deleteWorkspace(input: {
    userId: string;
    workspaceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome>;

  listProjects(input: {
    userId: string;
    workspaceId?: string;
    conversationId?: string;
  }): Promise<ProjectSummary[]>;

  getProject(input: {
    userId: string;
    projectId: string;
  }): Promise<ProjectSummary | null>;

  createProject(input: {
    userId: string;
    workspaceId: string;
    name: string;
    description: string | null;
  }): Promise<
    | { outcome: "committed"; value: ProjectSummary }
    | { outcome: "workspace_not_found" }
  >;

  updateProject(input: {
    userId: string;
    projectId: string;
    expectedVersion: number;
    name?: string;
    description?: string | null;
  }): Promise<VersionedMutationOutcome<ProjectSummary>>;

  deleteProject(input: {
    userId: string;
    projectId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome>;

  listResources(input: {
    userId: string;
    projectId: string;
    kind?: ProjectResourceKind;
  }): Promise<ProjectResourceSummary[] | null>;

  getResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
  }): Promise<ProjectResource | null>;

  createResource(input: {
    userId: string;
    projectId: string;
    kind: ProjectResourceKind;
    key: string;
    title: string | null;
    content: string | null;
    metadata: Record<string, unknown>;
  }): Promise<CreateResourceOutcome>;

  updateResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
    expectedVersion: number;
    title?: string | null;
    content?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<VersionedMutationOutcome<ProjectResource>>;

  deleteResource(input: {
    userId: string;
    projectId: string;
    resourceId: string;
    expectedVersion: number;
  }): Promise<DeleteMutationOutcome>;

  listProjectConversations(input: {
    userId: string;
    projectId: string;
  }): Promise<ProjectConversation[] | null>;

  attachConversation(input: {
    userId: string;
    projectId: string;
    conversationId: string;
  }): Promise<ProjectConversationMutationOutcome>;

  detachConversation(input: {
    userId: string;
    projectId: string;
    conversationId: string;
  }): Promise<ProjectConversationMutationOutcome>;
}
