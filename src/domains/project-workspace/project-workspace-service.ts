import type { ProjectResourceKind } from "../../database/schema.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import {
  PROJECT_RESOURCE_KINDS,
  type ProjectResource,
  type ProjectResourceSummary,
  type ProjectSummary,
  type ProductWorkspace,
  type ProjectWorkspace,
  type WorkspaceResource,
  type WorkspaceResourceSummary,
  type ProjectWorkspaceRepository,
} from "./project-workspace-types.js";

export type ProjectWorkspaceServiceErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "INVALID_PROJECT"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_IN_USE"
  | "PROJECT_NOT_FOUND"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "RESOURCE_CONFLICT"
  | "CONVERSATION_NOT_FOUND";

export class ProjectWorkspaceServiceError extends Error {
  constructor(
    readonly code: ProjectWorkspaceServiceErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ProjectWorkspaceServiceError";
  }
}

export class ProjectWorkspaceService {
  constructor(private readonly repository: ProjectWorkspaceRepository) {}

  async listProductWorkspaces(input: {
    userId: string;
    conversationId?: unknown;
  }): Promise<ProductWorkspace[]> {
    await this.requireUser(input.userId);
    return this.repository.listProductWorkspaces({
      userId: input.userId,
      ...(input.conversationId === undefined
        ? {}
        : {
            conversationId: uuid(
              input.conversationId,
              "conversationId",
            ),
          }),
    });
  }

  async getProductWorkspace(input: {
    userId: string;
    workspaceId: unknown;
  }): Promise<ProductWorkspace> {
    await this.requireUser(input.userId);
    const workspace = await this.repository.getProductWorkspace({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
    });
    if (!workspace) {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    return workspace;
  }

  async createProductWorkspace(input: {
    userId: string;
    name: unknown;
    description?: unknown;
  }): Promise<ProductWorkspace> {
    await this.requireUser(input.userId);
    return this.repository.createProductWorkspace({
      userId: input.userId,
      name: requiredText(input.name, 200, "name"),
      description: optionalText(input.description, 4000, "description"),
    });
  }

  async updateProductWorkspace(input: {
    userId: string;
    workspaceId: unknown;
    expectedVersion: unknown;
    name?: unknown;
    description?: unknown;
  }): Promise<ProductWorkspace> {
    await this.requireUser(input.userId);
    const hasName = input.name !== undefined;
    const hasDescription = input.description !== undefined;
    if (!hasName && !hasDescription) {
      invalid("Workspace update is empty.");
    }
    const result = await this.repository.updateProductWorkspace({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      expectedVersion: version(input.expectedVersion),
      ...(hasName
        ? { name: requiredText(input.name, 200, "name") }
        : {}),
      ...(hasDescription
        ? {
            description:
              optionalText(input.description, 4000, "description"),
          }
        : {}),
    });
    return unwrapVersioned(result, "WORKSPACE_NOT_FOUND");
  }

  async deleteProductWorkspace(input: {
    userId: string;
    workspaceId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await this.requireUser(input.userId);
    const result = await this.repository.deleteProductWorkspace({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      expectedVersion: version(input.expectedVersion),
    });
    if (result.outcome === "workspace_in_use") {
      throw new ProjectWorkspaceServiceError("WORKSPACE_IN_USE");
    }
    unwrapDelete(result, "WORKSPACE_NOT_FOUND");
  }

  async listWorkspaceResources(input: {
    userId: string;
    workspaceId: unknown;
    kind?: unknown;
  }): Promise<WorkspaceResourceSummary[]> {
    return workspaceSurface(async () => {
      const rows = await this.listResources({
        userId: input.userId,
        projectId: input.workspaceId,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
      });
      return rows.map(toWorkspaceResourceSummary);
    });
  }

  async getWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    resourceId: unknown;
  }): Promise<WorkspaceResource> {
    return workspaceSurface(async () =>
      toWorkspaceResource(await this.getResource({
        userId: input.userId,
        projectId: input.workspaceId,
        resourceId: input.resourceId,
      })));
  }

  async createWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    kind: unknown;
    key: unknown;
    title?: unknown;
    content?: unknown;
    metadata?: unknown;
  }): Promise<WorkspaceResource> {
    return workspaceSurface(async () =>
      toWorkspaceResource(await this.createResource({
        userId: input.userId,
        projectId: input.workspaceId,
        kind: input.kind,
        key: input.key,
        title: input.title,
        content: input.content,
        metadata: input.metadata,
      })));
  }

  async updateWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    resourceId: unknown;
    expectedVersion: unknown;
    title?: unknown;
    content?: unknown;
    metadata?: unknown;
  }): Promise<WorkspaceResource> {
    return workspaceSurface(async () =>
      toWorkspaceResource(await this.updateResource({
        userId: input.userId,
        projectId: input.workspaceId,
        resourceId: input.resourceId,
        expectedVersion: input.expectedVersion,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      })));
  }

  async deleteWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    resourceId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await workspaceSurface(() => this.deleteResource({
      userId: input.userId,
      projectId: input.workspaceId,
      resourceId: input.resourceId,
      expectedVersion: input.expectedVersion,
    }));
  }

  listWorkspaceConversations(input: {
    userId: string;
    workspaceId: unknown;
  }) {
    return workspaceSurface(() => this.listProjectConversations({
      userId: input.userId,
      projectId: input.workspaceId,
    }));
  }

  attachWorkspaceConversation(input: {
    userId: string;
    workspaceId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    return workspaceSurface(() => this.attachConversation({
      userId: input.userId,
      projectId: input.workspaceId,
      conversationId: input.conversationId,
    }));
  }

  detachWorkspaceConversation(input: {
    userId: string;
    workspaceId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    return workspaceSurface(() => this.detachConversation({
      userId: input.userId,
      projectId: input.workspaceId,
      conversationId: input.conversationId,
    }));
  }

  async listWorkspaces(userId: string): Promise<ProjectWorkspace[]> {
    await this.requireUser(userId);
    return this.repository.listWorkspaces(userId);
  }

  async createWorkspace(input: {
    userId: string;
    name: unknown;
    description?: unknown;
  }): Promise<ProjectWorkspace> {
    await this.requireUser(input.userId);
    return this.repository.createWorkspace({
      userId: input.userId,
      name: requiredText(input.name, 200, "name"),
      description: optionalText(input.description, 4000, "description"),
    });
  }

  async updateWorkspace(input: {
    userId: string;
    workspaceId: unknown;
    expectedVersion: unknown;
    name?: unknown;
    description?: unknown;
  }): Promise<ProjectWorkspace> {
    await this.requireUser(input.userId);
    const workspaceId = uuid(input.workspaceId, "workspaceId");
    const expectedVersion = version(input.expectedVersion);
    const hasName = input.name !== undefined;
    const hasDescription = input.description !== undefined;
    if (!hasName && !hasDescription) invalid("Workspace update is empty.");

    const result = await this.repository.updateWorkspace({
      userId: input.userId,
      workspaceId,
      expectedVersion,
      ...(hasName
        ? { name: requiredText(input.name, 200, "name") }
        : {}),
      ...(hasDescription
        ? {
            description:
              optionalText(input.description, 4000, "description"),
          }
        : {}),
    });
    return unwrapVersioned(result, "WORKSPACE_NOT_FOUND");
  }

  async deleteWorkspace(input: {
    userId: string;
    workspaceId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await this.requireUser(input.userId);
    const result = await this.repository.deleteWorkspace({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      expectedVersion: version(input.expectedVersion),
    });
    unwrapDelete(result, "WORKSPACE_NOT_FOUND");
  }

  async listProjects(input: {
    userId: string;
    workspaceId?: unknown;
    conversationId?: unknown;
  }): Promise<ProjectSummary[]> {
    await this.requireUser(input.userId);
    return this.repository.listProjects({
      userId: input.userId,
      ...(input.workspaceId === undefined
        ? {}
        : { workspaceId: uuid(input.workspaceId, "workspaceId") }),
      ...(input.conversationId === undefined
        ? {}
        : {
            conversationId: uuid(
              input.conversationId,
              "conversationId",
            ),
          }),
    });
  }

  async getProject(input: {
    userId: string;
    projectId: unknown;
  }): Promise<ProjectSummary> {
    await this.requireUser(input.userId);
    const project = await this.repository.getProject({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
    });
    if (!project) {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    return project;
  }

  async createProject(input: {
    userId: string;
    workspaceId: unknown;
    name: unknown;
    description?: unknown;
  }): Promise<ProjectSummary> {
    await this.requireUser(input.userId);
    const result = await this.repository.createProject({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      name: requiredText(input.name, 200, "name"),
      description: optionalText(input.description, 4000, "description"),
    });
    if (result.outcome === "workspace_not_found") {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    return result.value;
  }

  async updateProject(input: {
    userId: string;
    projectId: unknown;
    expectedVersion: unknown;
    name?: unknown;
    description?: unknown;
  }): Promise<ProjectSummary> {
    await this.requireUser(input.userId);
    const hasName = input.name !== undefined;
    const hasDescription = input.description !== undefined;
    if (!hasName && !hasDescription) invalid("Project update is empty.");

    const result = await this.repository.updateProject({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      expectedVersion: version(input.expectedVersion),
      ...(hasName
        ? { name: requiredText(input.name, 200, "name") }
        : {}),
      ...(hasDescription
        ? {
            description:
              optionalText(input.description, 4000, "description"),
          }
        : {}),
    });
    return unwrapVersioned(result, "PROJECT_NOT_FOUND");
  }

  async deleteProject(input: {
    userId: string;
    projectId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await this.requireUser(input.userId);
    const result = await this.repository.deleteProject({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      expectedVersion: version(input.expectedVersion),
    });
    unwrapDelete(result, "PROJECT_NOT_FOUND");
  }

  async listResources(input: {
    userId: string;
    projectId: unknown;
    kind?: unknown;
  }): Promise<ProjectResourceSummary[]> {
    await this.requireUser(input.userId);
    const rows = await this.repository.listResources({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      ...(input.kind === undefined
        ? {}
        : { kind: resourceKind(input.kind) }),
    });
    if (!rows) {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    return rows;
  }

  async getResource(input: {
    userId: string;
    projectId: unknown;
    resourceId: unknown;
  }): Promise<ProjectResource> {
    await this.requireUser(input.userId);
    const resource = await this.repository.getResource({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      resourceId: uuid(input.resourceId, "resourceId"),
    });
    if (!resource) {
      throw new ProjectWorkspaceServiceError("RESOURCE_NOT_FOUND");
    }
    return resource;
  }

  async createResource(input: {
    userId: string;
    projectId: unknown;
    kind: unknown;
    key: unknown;
    title?: unknown;
    content?: unknown;
    metadata?: unknown;
  }): Promise<ProjectResource> {
    await this.requireUser(input.userId);
    const kind = resourceKind(input.kind);
    const key = resourceKey(kind, input.key);
    const result = await this.repository.createResource({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      kind,
      key,
      title: optionalText(input.title, 500, "title"),
      content: optionalContent(input.content),
      metadata: metadata(input.metadata),
    });
    if (result.outcome === "project_not_found") {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    if (result.outcome === "resource_conflict") {
      throw new ProjectWorkspaceServiceError("RESOURCE_CONFLICT");
    }
    return result.value;
  }

  async updateResource(input: {
    userId: string;
    projectId: unknown;
    resourceId: unknown;
    expectedVersion: unknown;
    title?: unknown;
    content?: unknown;
    metadata?: unknown;
  }): Promise<ProjectResource> {
    await this.requireUser(input.userId);
    const hasTitle = input.title !== undefined;
    const hasContent = input.content !== undefined;
    const hasMetadata = input.metadata !== undefined;
    if (!hasTitle && !hasContent && !hasMetadata) {
      invalid("Project resource update is empty.");
    }

    const result = await this.repository.updateResource({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      resourceId: uuid(input.resourceId, "resourceId"),
      expectedVersion: version(input.expectedVersion),
      ...(hasTitle
        ? { title: optionalText(input.title, 500, "title") }
        : {}),
      ...(hasContent
        ? { content: optionalContent(input.content) }
        : {}),
      ...(hasMetadata
        ? { metadata: metadata(input.metadata) }
        : {}),
    });
    return unwrapVersioned(result, "RESOURCE_NOT_FOUND");
  }

  async deleteResource(input: {
    userId: string;
    projectId: unknown;
    resourceId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await this.requireUser(input.userId);
    const result = await this.repository.deleteResource({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      resourceId: uuid(input.resourceId, "resourceId"),
      expectedVersion: version(input.expectedVersion),
    });
    unwrapDelete(result, "RESOURCE_NOT_FOUND");
  }

  async listProjectConversations(input: {
    userId: string;
    projectId: unknown;
  }) {
    await this.requireUser(input.userId);
    const rows = await this.repository.listProjectConversations({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
    });
    if (!rows) {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    return rows;
  }

  async attachConversation(input: {
    userId: string;
    projectId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    await this.requireUser(input.userId);
    const result = await this.repository.attachConversation({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      conversationId: uuid(input.conversationId, "conversationId"),
    });
    if (result.outcome === "project_not_found") {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    if (result.outcome === "conversation_not_found") {
      throw new ProjectWorkspaceServiceError("CONVERSATION_NOT_FOUND");
    }
    return { applied: result.outcome === "committed" };
  }

  async detachConversation(input: {
    userId: string;
    projectId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    await this.requireUser(input.userId);
    const result = await this.repository.detachConversation({
      userId: input.userId,
      projectId: uuid(input.projectId, "projectId"),
      conversationId: uuid(input.conversationId, "conversationId"),
    });
    if (result.outcome === "project_not_found") {
      throw new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    }
    return { applied: result.outcome === "committed" };
  }

  private async requireUser(userId: string): Promise<void> {
    try {
      await requireActiveUser(this.repository, userId);
    } catch (error) {
      if (error instanceof ActiveUserAuthorizationError) {
        throw new ProjectWorkspaceServiceError(error.code);
      }
      throw error;
    }
  }
}

async function workspaceSurface<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProjectWorkspaceServiceError
      && error.code === "PROJECT_NOT_FOUND"
    ) {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    throw error;
  }
}

function toWorkspaceResourceSummary(
  value: ProjectResourceSummary,
): WorkspaceResourceSummary {
  const { projectId, ...rest } = value;
  return {
    ...rest,
    workspaceId: projectId,
  };
}

function toWorkspaceResource(
  value: ProjectResource,
): WorkspaceResource {
  const { projectId, ...rest } = value;
  return {
    ...rest,
    workspaceId: projectId,
  };
}

function resourceKind(value: unknown): ProjectResourceKind {
  if (
    typeof value !== "string"
    || !(PROJECT_RESOURCE_KINDS as readonly string[]).includes(value)
  ) {
    invalid("Project resource kind is invalid.");
  }
  return value as ProjectResourceKind;
}

function resourceKey(
  kind: ProjectResourceKind,
  value: unknown,
): string {
  const key = requiredText(value, 1000, "key");
  if (kind !== "file") return key;
  if (
    key.startsWith("/")
    || key.includes("\\")
    || key.split("/").some((part) => part === ".." || part === ".")
  ) {
    invalid("Project file key must be a relative logical path.");
  }
  return key.replace(/\/+/gu, "/");
}

function requiredText(
  value: unknown,
  maxLength: number,
  label: string,
): string {
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    invalid(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  maxLength: number,
  label: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) invalid(`${label} is too long.`);
  return normalized;
}

function optionalContent(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid("content must be text.");
  if (value.length > 1_000_000) invalid("content is too long.");
  return value;
}

function metadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("metadata must be an object.");
  }
  return value as Record<string, unknown>;
}

function version(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 1
  ) {
    invalid("expected_version must be a positive integer.");
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    invalid(`${label} must be a UUID.`);
  }
  return value;
}

function unwrapVersioned<T>(
  result:
    | { outcome: "committed"; value: T }
    | { outcome: "not_found" }
    | { outcome: "version_conflict" },
  notFoundCode: "WORKSPACE_NOT_FOUND" | "PROJECT_NOT_FOUND" | "RESOURCE_NOT_FOUND",
): T {
  if (result.outcome === "committed") return result.value;
  if (result.outcome === "version_conflict") {
    throw new ProjectWorkspaceServiceError("VERSION_CONFLICT");
  }
  throw new ProjectWorkspaceServiceError(notFoundCode);
}

function unwrapDelete(
  result:
    | { outcome: "deleted" }
    | { outcome: "not_found" }
    | { outcome: "version_conflict" },
  notFoundCode: "WORKSPACE_NOT_FOUND" | "PROJECT_NOT_FOUND" | "RESOURCE_NOT_FOUND",
): void {
  if (result.outcome === "deleted") return;
  if (result.outcome === "version_conflict") {
    throw new ProjectWorkspaceServiceError("VERSION_CONFLICT");
  }
  throw new ProjectWorkspaceServiceError(notFoundCode);
}

function invalid(message: string): never {
  throw new ProjectWorkspaceServiceError("INVALID_PROJECT", message);
}
