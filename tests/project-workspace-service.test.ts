import assert from "node:assert/strict";
import test from "node:test";
import {
  ProjectWorkspaceService,
  ProjectWorkspaceServiceError,
} from "../src/domains/project-workspace/project-workspace-service.js";
import type {
  ProjectWorkspaceRepository,
  ProjectWorkspace,
  ProjectSummary,
  ProjectResource,
} from "../src/domains/project-workspace/project-workspace-types.js";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const resourceId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";

const workspace: ProjectWorkspace = {
  id: workspaceId,
  name: "Default",
  description: null,
  version: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const project: ProjectSummary = {
  id: projectId,
  workspaceId,
  name: "LeileiOS",
  description: null,
  version: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const resource: ProjectResource = {
  id: resourceId,
  projectId,
  kind: "file",
  key: "docs/index.md",
  title: null,
  content: "# hi",
  metadata: {},
  version: 1,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

class Repository implements ProjectWorkspaceRepository {
  last: { name: string; input: unknown } | null = null;
  updateWorkspaceOutcome:
    | { outcome: "committed"; value: ProjectWorkspace }
    | { outcome: "not_found" }
    | { outcome: "version_conflict" } = {
      outcome: "committed",
      value: { ...workspace, version: 2 },
    };

  async findUserById() {
    return { status: "active" as const };
  }
  async listWorkspaces() { return [workspace]; }
  async createWorkspace(input: Parameters<ProjectWorkspaceRepository["createWorkspace"]>[0]) {
    this.last = { name: "createWorkspace", input };
    return workspace;
  }
  async updateWorkspace(input: Parameters<ProjectWorkspaceRepository["updateWorkspace"]>[0]) {
    this.last = { name: "updateWorkspace", input };
    return this.updateWorkspaceOutcome;
  }
  async deleteWorkspace() { return { outcome: "deleted" as const }; }
  async listProjects(input: Parameters<ProjectWorkspaceRepository["listProjects"]>[0]) {
    this.last = { name: "listProjects", input };
    return [project];
  }
  async getProject() { return project; }
  async createProject(input: Parameters<ProjectWorkspaceRepository["createProject"]>[0]) {
    this.last = { name: "createProject", input };
    return { outcome: "committed" as const, value: project };
  }
  async updateProject() {
    return { outcome: "committed" as const, value: { ...project, version: 2 } };
  }
  async deleteProject() { return { outcome: "deleted" as const }; }
  async listResources() { return [resource]; }
  async createResource(input: Parameters<ProjectWorkspaceRepository["createResource"]>[0]) {
    this.last = { name: "createResource", input };
    return {
      outcome: "committed" as const,
      value: { ...resource, kind: input.kind, key: input.key },
    };
  }
  async updateResource() {
    return { outcome: "committed" as const, value: { ...resource, version: 2 } };
  }
  async deleteResource() { return { outcome: "deleted" as const }; }
  async listProjectConversations() { return []; }
  async attachConversation(input: Parameters<ProjectWorkspaceRepository["attachConversation"]>[0]) {
    this.last = { name: "attachConversation", input };
    return { outcome: "committed" as const };
  }
  async detachConversation() { return { outcome: "already_applied" as const }; }
}

test("Workspace and Project service normalizes durable product inputs", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  await service.createWorkspace({
    userId,
    name: "  Personal  ",
    description: "  durable workspace  ",
  });
  assert.deepEqual(repository.last, {
    name: "createWorkspace",
    input: {
      userId,
      name: "Personal",
      description: "durable workspace",
    },
  });

  await service.createProject({
    userId,
    workspaceId,
    name: "  LeileiOS  ",
  });
  assert.deepEqual(repository.last, {
    name: "createProject",
    input: {
      userId,
      workspaceId,
      name: "LeileiOS",
      description: null,
    },
  });
});

test("Project file resources use logical relative paths and reject local filesystem identity", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  await service.createResource({
    userId,
    projectId,
    kind: "file",
    key: "docs//index.md",
    content: "",
  });
  assert.deepEqual(repository.last, {
    name: "createResource",
    input: {
      userId,
      projectId,
      kind: "file",
      key: "docs/index.md",
      title: null,
      content: "",
      metadata: {},
    },
  });

  await assert.rejects(
    service.createResource({
      userId,
      projectId,
      kind: "file",
      key: "/Users/lei/secret.md",
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "INVALID_PROJECT",
  );
  await assert.rejects(
    service.createResource({
      userId,
      projectId,
      kind: "file",
      key: "../secret.md",
    }),
    /relative logical path/,
  );
});

test("version conflicts stay observable instead of silently overwriting", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);
  repository.updateWorkspaceOutcome = { outcome: "version_conflict" };

  await assert.rejects(
    service.updateWorkspace({
      userId,
      workspaceId,
      expectedVersion: 1,
      name: "Changed",
    }),
    (error: unknown) =>
      error instanceof ProjectWorkspaceServiceError
      && error.code === "VERSION_CONFLICT",
  );
});

test("Project conversation membership delegates canonical ids and is idempotent", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  assert.deepEqual(
    await service.attachConversation({
      userId,
      projectId,
      conversationId,
    }),
    { applied: true },
  );
  assert.deepEqual(repository.last, {
    name: "attachConversation",
    input: { userId, projectId, conversationId },
  });

  assert.deepEqual(
    await service.detachConversation({
      userId,
      projectId,
      conversationId,
    }),
    { applied: false },
  );
});

test("workspace filter and resource kind are validated before persistence", async () => {
  const repository = new Repository();
  const service = new ProjectWorkspaceService(repository);

  await service.listProjects({ userId, workspaceId });
  assert.deepEqual(repository.last, {
    name: "listProjects",
    input: { userId, workspaceId },
  });

  await assert.rejects(
    service.listResources({
      userId,
      projectId,
      kind: "dream",
    }),
    /kind is invalid/,
  );
});
