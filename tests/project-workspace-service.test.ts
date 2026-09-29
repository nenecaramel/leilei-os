import assert from "node:assert/strict";
import test from "node:test";
import {
  ProjectWorkspaceService,
  ProjectWorkspaceServiceError,
} from "../src/domains/project-workspace/project-workspace-service.js";
import type {
  ProductWorkspace,
  ProjectWorkspaceRepository,
  WorkspaceResource,
  WorkspaceResourceSummary,
} from "../src/domains/project-workspace/project-workspace-types.js";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const resourceId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

const workspace: ProductWorkspace = {
  id: workspaceId,
  name: "LeileiOS",
  description: null,
  version: 1,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const resource: WorkspaceResource = {
  id: resourceId,
  workspaceId,
  kind: "file",
  key: "docs/index.md",
  title: null,
  content: "# hi",
  metadata: {},
  version: 1,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

class Repository implements ProjectWorkspaceRepository {
  last: { name: string; input: unknown } | null = null;
  userStatus: "active" | "disabled" | null = "active";
  createWorkspaceOutcome:
    Awaited<ReturnType<ProjectWorkspaceRepository["createProductWorkspace"]>> =
      { outcome: "committed", value: workspace };
  updateWorkspaceOutcome:
    Awaited<ReturnType<ProjectWorkspaceRepository["updateProductWorkspace"]>> =
      { outcome: "committed", value: { ...workspace, version: 2 } };
  deleteWorkspaceOutcome:
    Awaited<ReturnType<ProjectWorkspaceRepository["deleteProductWorkspace"]>> =
      { outcome: "deleted" };

  async findUserById() {
    return this.userStatus === null ? null : { status: this.userStatus };
  }

  async listProductWorkspaces(
    input: Parameters<ProjectWorkspaceRepository["listProductWorkspaces"]>[0],
  ) {
    this.last = { name: "listProductWorkspaces", input };
    return [workspace];
  }

  async getProductWorkspace(
    input: Parameters<ProjectWorkspaceRepository["getProductWorkspace"]>[0],
  ) {
    this.last = { name: "getProductWorkspace", input };
    return workspace;
  }

  async createProductWorkspace(
    input: Parameters<ProjectWorkspaceRepository["createProductWorkspace"]>[0],
  ) {
    this.last = { name: "createProductWorkspace", input };
    return this.createWorkspaceOutcome;
  }

  async updateProductWorkspace(
    input: Parameters<ProjectWorkspaceRepository["updateProductWorkspace"]>[0],
  ) {
    this.last = { name: "updateProductWorkspace", input };
    return this.updateWorkspaceOutcome;
  }

  async deleteProductWorkspace(
    input: Parameters<ProjectWorkspaceRepository["deleteProductWorkspace"]>[0],
  ) {
    this.last = { name: "deleteProductWorkspace", input };
    return this.deleteWorkspaceOutcome;
  }

  async listWorkspaceResources(
    input: Parameters<ProjectWorkspaceRepository["listWorkspaceResources"]>[0],
  ): Promise<WorkspaceResourceSummary[] | null> {
    this.last = { name: "listWorkspaceResources", input };
    const { content: _content, ...summary } = resource;
    return [summary];
  }

  async getWorkspaceResource(
    input: Parameters<ProjectWorkspaceRepository["getWorkspaceResource"]>[0],
  ) {
    this.last = { name: "getWorkspaceResource", input };
    return resource;
  }

  async createWorkspaceResource(
    input: Parameters<ProjectWorkspaceRepository["createWorkspaceResource"]>[0],
  ) {
    this.last = { name: "createWorkspaceResource", input };
    return {
      outcome: "committed" as const,
      value: {
        ...resource,
        workspaceId: input.workspaceId,
        kind: input.kind,
        key: input.key,
        title: input.title,
        content: input.content,
        metadata: input.metadata,
      },
    };
  }

  async updateWorkspaceResource(
    input: Parameters<ProjectWorkspaceRepository["updateWorkspaceResource"]>[0],
  ) {
    this.last = { name: "updateWorkspaceResource", input };
    return {
      outcome: "committed" as const,
      value: { ...resource, version: 2 },
    };
  }

  async deleteWorkspaceResource(
    input: Parameters<ProjectWorkspaceRepository["deleteWorkspaceResource"]>[0],
  ) {
    this.last = { name: "deleteWorkspaceResource", input };
    return { outcome: "deleted" as const };
  }

  async listWorkspaceConversations(
    input: Parameters<ProjectWorkspaceRepository["listWorkspaceConversations"]>[0],
  ) {
    this.last = { name: "listWorkspaceConversations", input };
    return [];
  }

  async attachWorkspaceConversation(
    input: Parameters<ProjectWorkspaceRepository["attachWorkspaceConversation"]>[0],
  ) {
    this.last = { name: "attachWorkspaceConversation", input };
    return { outcome: "committed" as const };
  }

  async detachWorkspaceConversation(
    input: Parameters<ProjectWorkspaceRepository["detachWorkspaceConversation"]>[0],
  ) {
    this.last = { name: "detachWorkspaceConversation", input };
    return { outcome: "already_applied" as const };
  }
}

test("single-layer Workspace service owns one public durable identity", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  assert.deepEqual(await service.listProductWorkspaces({ userId }), [workspace]);
  assert.deepEqual(
    await service.getProductWorkspace({ userId, workspaceId }),
    workspace,
  );

  await service.createProductWorkspace({
    userId,
    name: "  LeileiOS  ",
    description: "  single layer  ",
    idempotencyKey: "workspace-create-0001",
  });
  assert.equal(repository.last?.name, "createProductWorkspace");
  assert.deepEqual(
    (repository.last?.input as { name: string; description: string | null }),
    {
      ...(repository.last!.input as Record<string, unknown>),
      name: "LeileiOS",
      description: "single layer",
    },
  );

  const updated = await service.updateProductWorkspace({
    userId,
    workspaceId,
    expectedVersion: 1,
    name: "  Changed  ",
  });
  assert.equal(updated.version, 2);
  assert.equal(repository.last?.name, "updateProductWorkspace");
});

test("Workspace resources expose workspaceId and validate relative file keys", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  const listed = await service.listWorkspaceResources({
    userId,
    workspaceId,
    kind: "file",
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.workspaceId, workspaceId);
  assert.equal(Object.hasOwn(listed[0]!, "content"), false);

  const detail = await service.getWorkspaceResource({
    userId,
    workspaceId,
    resourceId,
  });
  assert.equal(detail.content, "# hi");

  const created = await service.createWorkspaceResource({
    userId,
    workspaceId,
    kind: "file",
    key: "docs//guide.md",
    content: "guide",
    idempotencyKey: "workspace-resource-0001",
  });
  assert.equal(created.workspaceId, workspaceId);
  assert.equal(created.key, "docs/guide.md");

  for (const key of ["/tmp/x", "../x", "a/../b", "C:\\x"]) {
    await assert.rejects(
      service.createWorkspaceResource({
        userId,
        workspaceId,
        kind: "file",
        key,
        idempotencyKey: "workspace-resource-bad1",
      }),
      (error: unknown) =>
        error instanceof ProjectWorkspaceServiceError
        && error.code === "INVALID_WORKSPACE",
    );
  }
});

test("Workspace create and mutation conflicts remain observable", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  repository.createWorkspaceOutcome = { outcome: "idempotency_conflict" };
  await assert.rejects(
    service.createProductWorkspace({
      userId,
      name: "Different",
      idempotencyKey: "workspace-create-0002",
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "IDEMPOTENCY_CONFLICT",
  );

  repository.updateWorkspaceOutcome = { outcome: "version_conflict" };
  await assert.rejects(
    service.updateProductWorkspace({
      userId,
      workspaceId,
      expectedVersion: 1,
      name: "stale",
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "VERSION_CONFLICT",
  );

  repository.deleteWorkspaceOutcome = { outcome: "workspace_in_use" };
  await assert.rejects(
    service.deleteProductWorkspace({
      userId,
      workspaceId,
      expectedVersion: 1,
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "WORKSPACE_IN_USE",
  );
});

test("Workspace conversation membership uses Workspace ids directly", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  assert.deepEqual(
    await service.attachWorkspaceConversation({
      userId,
      workspaceId,
      conversationId,
    }),
    { applied: true },
  );
  assert.deepEqual(repository.last, {
    name: "attachWorkspaceConversation",
    input: { userId, workspaceId, conversationId },
  });

  assert.deepEqual(
    await service.detachWorkspaceConversation({
      userId,
      workspaceId,
      conversationId,
    }),
    { applied: false },
  );
});

test("Workspace filters and resource kinds are validated before persistence", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  await service.listProductWorkspaces({ userId, conversationId });
  assert.deepEqual(repository.last, {
    name: "listProductWorkspaces",
    input: { userId, conversationId },
  });

  await assert.rejects(
    service.listProductWorkspaces({ userId, conversationId: "bad" }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "INVALID_WORKSPACE",
  );

  await assert.rejects(
    service.listWorkspaceResources({
      userId,
      workspaceId,
      kind: "bogus",
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "INVALID_WORKSPACE",
  );
});

test("durable create requires idempotency keys and active user", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  await assert.rejects(
    service.createProductWorkspace({ userId, name: "LeileiOS" }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "INVALID_IDEMPOTENCY_KEY",
  );

  repository.userStatus = "disabled";
  await assert.rejects(
    service.listProductWorkspaces({ userId }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "USER_DISABLED",
  );
});
