import type { ProjectResourceKind } from "../../database/schema.js";
import {
  hashProductCreateRequest,
  normalizeProductCreateIdempotencyKey,
  ProductCreateIdempotencyError,
} from "../product-write/product-create-idempotency.js";
import {
  ActiveUserAuthorizationError,
  requireActiveUser,
} from "../require-active-user.js";
import {
  PROJECT_RESOURCE_KINDS,
  type ProductWorkspace,
  type WorkspaceResource,
  type WorkspaceResourceSummary,
  type ProjectWorkspaceRepository,
} from "./project-workspace-types.js";

export type ProjectWorkspaceServiceErrorCode =
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "INVALID_WORKSPACE"
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_IN_USE"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "RESOURCE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_IDEMPOTENCY_KEY"
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
    idempotencyKey?: unknown;
  }): Promise<ProductWorkspace> {
    await this.requireUser(input.userId);
    const name = requiredText(input.name, 200, "name");
    const description = optionalText(
      input.description,
      4000,
      "description",
    );
    const idempotencyKey = productCreateIdempotencyKey(
      input.idempotencyKey,
    );
    const result = await this.repository.createProductWorkspace({
      userId: input.userId,
      name,
      description,
      idempotencyKey,
      requestHash: hashProductCreateRequest({
        operation: "workspace_create",
        name,
        description,
      }),
    });
    if (result.outcome === "idempotency_conflict") {
      throw new ProjectWorkspaceServiceError("IDEMPOTENCY_CONFLICT");
    }
    return result.value;
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
    await this.requireUser(input.userId);
    const rows = await this.repository.listWorkspaceResources({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      ...(input.kind === undefined
        ? {}
        : { kind: resourceKind(input.kind) }),
    });
    if (!rows) {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    return rows;
  }

  async getWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    resourceId: unknown;
  }): Promise<WorkspaceResource> {
    await this.requireUser(input.userId);
    const row = await this.repository.getWorkspaceResource({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      resourceId: uuid(input.resourceId, "resourceId"),
    });
    if (!row) {
      throw new ProjectWorkspaceServiceError("RESOURCE_NOT_FOUND");
    }
    return row;
  }

  async createWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    kind: unknown;
    key: unknown;
    title?: unknown;
    content?: unknown;
    metadata?: unknown;
    idempotencyKey?: unknown;
  }): Promise<WorkspaceResource> {
    await this.requireUser(input.userId);
    const workspaceId = uuid(input.workspaceId, "workspaceId");
    const kind = resourceKind(input.kind);
    const key = resourceKey(kind, input.key);
    const title = optionalText(input.title, 500, "title");
    const content = optionalContent(input.content);
    const normalizedMetadata = metadata(input.metadata);
    const idempotencyKey = productCreateIdempotencyKey(
      input.idempotencyKey,
    );
    const result = await this.repository.createWorkspaceResource({
      userId: input.userId,
      workspaceId,
      kind,
      key,
      title,
      content,
      metadata: normalizedMetadata,
      idempotencyKey,
      requestHash: hashProductCreateRequest({
        operation: "workspace_resource_create",
        workspaceId,
        kind,
        key,
        title,
        content,
        metadata: normalizedMetadata,
      }),
    });
    if (result.outcome === "workspace_not_found") {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    if (result.outcome === "resource_conflict") {
      throw new ProjectWorkspaceServiceError("RESOURCE_CONFLICT");
    }
    if (result.outcome === "idempotency_conflict") {
      throw new ProjectWorkspaceServiceError("IDEMPOTENCY_CONFLICT");
    }
    return result.value;
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
    await this.requireUser(input.userId);
    const hasTitle = input.title !== undefined;
    const hasContent = input.content !== undefined;
    const hasMetadata = input.metadata !== undefined;
    if (!hasTitle && !hasContent && !hasMetadata) {
      invalid("Workspace resource update is empty.");
    }
    const result = await this.repository.updateWorkspaceResource({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
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

  async deleteWorkspaceResource(input: {
    userId: string;
    workspaceId: unknown;
    resourceId: unknown;
    expectedVersion: unknown;
  }): Promise<void> {
    await this.requireUser(input.userId);
    const result = await this.repository.deleteWorkspaceResource({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      resourceId: uuid(input.resourceId, "resourceId"),
      expectedVersion: version(input.expectedVersion),
    });
    unwrapDelete(result, "RESOURCE_NOT_FOUND");
  }

  async listWorkspaceConversations(input: {
    userId: string;
    workspaceId: unknown;
  }) {
    await this.requireUser(input.userId);
    const rows = await this.repository.listWorkspaceConversations({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
    });
    if (!rows) {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    return rows;
  }

  async attachWorkspaceConversation(input: {
    userId: string;
    workspaceId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    await this.requireUser(input.userId);
    const result = await this.repository.attachWorkspaceConversation({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      conversationId: uuid(input.conversationId, "conversationId"),
    });
    if (result.outcome === "workspace_not_found") {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    }
    if (result.outcome === "conversation_not_found") {
      throw new ProjectWorkspaceServiceError("CONVERSATION_NOT_FOUND");
    }
    return { applied: result.outcome === "committed" };
  }

  async detachWorkspaceConversation(input: {
    userId: string;
    workspaceId: unknown;
    conversationId: unknown;
  }): Promise<{ applied: boolean }> {
    await this.requireUser(input.userId);
    const result = await this.repository.detachWorkspaceConversation({
      userId: input.userId,
      workspaceId: uuid(input.workspaceId, "workspaceId"),
      conversationId: uuid(input.conversationId, "conversationId"),
    });
    if (result.outcome === "workspace_not_found") {
      throw new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
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

function resourceKind(value: unknown): ProjectResourceKind {
  if (
    typeof value !== "string"
    || !(PROJECT_RESOURCE_KINDS as readonly string[]).includes(value)
  ) {
    invalid("Workspace resource kind is invalid.");
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
    invalid("Workspace file key must be a relative logical path.");
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
  notFoundCode: "WORKSPACE_NOT_FOUND" | "RESOURCE_NOT_FOUND",
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
  notFoundCode: "WORKSPACE_NOT_FOUND" | "RESOURCE_NOT_FOUND",
): void {
  if (result.outcome === "deleted") return;
  if (result.outcome === "version_conflict") {
    throw new ProjectWorkspaceServiceError("VERSION_CONFLICT");
  }
  throw new ProjectWorkspaceServiceError(notFoundCode);
}

function productCreateIdempotencyKey(value: unknown): string {
  try {
    return normalizeProductCreateIdempotencyKey(value);
  } catch (error) {
    if (error instanceof ProductCreateIdempotencyError) {
      throw new ProjectWorkspaceServiceError(
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key is required and must be 16-128 safe characters.",
      );
    }
    throw error;
  }
}

function invalid(message: string): never {
  throw new ProjectWorkspaceServiceError("INVALID_WORKSPACE", message);
}
