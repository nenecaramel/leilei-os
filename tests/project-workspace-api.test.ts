import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createProjectWorkspaceApiRouter,
  type ProjectWorkspaceApiDependencies,
} from "../src/web-api/project-workspace-router.js";
import {
  ProjectWorkspaceServiceError,
} from "../src/domains/project-workspace/project-workspace-service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const resourceId = "44444444-4444-4444-8444-444444444444";
const conversationId = "55555555-5555-4555-8555-555555555555";

class FakeService {
  calls: Array<{ name: string; input: unknown }> = [];
  failure: ProjectWorkspaceServiceError | null = null;

  private maybeFail() {
    if (this.failure) throw this.failure;
  }

  async listWorkspaces(user: string) {
    this.maybeFail();
    this.calls.push({ name: "listWorkspaces", input: user });
    return [];
  }
  async createWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createWorkspace", input });
    return { id: workspaceId };
  }
  async updateWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateWorkspace", input });
    return { id: workspaceId, version: 2 };
  }
  async deleteWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "deleteWorkspace", input });
  }
  async listProjects(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listProjects", input });
    return [];
  }
  async getProject(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "getProject", input });
    return { id: projectId };
  }
  async createProject(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createProject", input });
    return { id: projectId };
  }
  async updateProject(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateProject", input });
    return { id: projectId, version: 2 };
  }
  async deleteProject(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "deleteProject", input });
  }
  async listResources(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listResources", input });
    return [];
  }
  async getResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "getResource", input });
    return { id: resourceId, content: "detail" };
  }
  async createResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createResource", input });
    return { id: resourceId };
  }
  async updateResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateResource", input });
    return { id: resourceId, version: 2 };
  }
  async deleteResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "deleteResource", input });
  }
  async listProjectConversations(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listProjectConversations", input });
    return [];
  }
  async attachConversation(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "attachConversation", input });
    return { applied: true };
  }
  async detachConversation(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "detachConversation", input });
    return { applied: true };
  }
}

async function withServer(
  service: FakeService,
  work: (baseUrl: string) => Promise<void>,
  authenticated = true,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    if (authenticated) request.webUserId = userId;
    next();
  });
  app.use(
    createProjectWorkspaceApiRouter({
      projectWorkspaceService:
        service as unknown as ProjectWorkspaceApiDependencies["projectWorkspaceService"],
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("Projects API exposes Workspace Project Resource and Conversation contracts", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/workspaces`)).status, 200);

    const workspaceCreate = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Personal" }),
    });
    assert.equal(workspaceCreate.status, 201);

    const projectCreate = await fetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspace_id: workspaceId,
        name: "LeileiOS",
      }),
    });
    assert.equal(projectCreate.status, 201);

    assert.equal(
      (await fetch(
        `${baseUrl}/projects?workspace_id=${workspaceId}`,
      )).status,
      200,
    );

    const resourceCreate = await fetch(
      `${baseUrl}/projects/${projectId}/resources`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "instructions",
          key: "default",
          content: "Use the project context.",
        }),
      },
    );
    assert.equal(resourceCreate.status, 201);

    assert.equal(
      (await fetch(
        `${baseUrl}/projects/${projectId}/resources?kind=instructions`,
      )).status,
      200,
    );

    assert.equal(
      (await fetch(
        `${baseUrl}/projects/${projectId}/resources/${resourceId}`,
      )).status,
      200,
    );

    const attach = await fetch(
      `${baseUrl}/projects/${projectId}/conversations/${conversationId}`,
      { method: "PUT" },
    );
    assert.equal(attach.status, 200);

    assert.equal(
      (await fetch(
        `${baseUrl}/projects/${projectId}/conversations`,
      )).status,
      200,
    );

    const detach = await fetch(
      `${baseUrl}/projects/${projectId}/conversations/${conversationId}`,
      { method: "DELETE" },
    );
    assert.equal(detach.status, 200);
  });

  assert.deepEqual(service.calls, [
    { name: "listWorkspaces", input: userId },
    {
      name: "createWorkspace",
      input: { userId, name: "Personal", description: undefined },
    },
    {
      name: "createProject",
      input: {
        userId,
        workspaceId,
        name: "LeileiOS",
        description: undefined,
      },
    },
    {
      name: "listProjects",
      input: { userId, workspaceId },
    },
    {
      name: "createResource",
      input: {
        userId,
        projectId,
        kind: "instructions",
        key: "default",
        title: undefined,
        content: "Use the project context.",
        metadata: undefined,
      },
    },
    {
      name: "listResources",
      input: { userId, projectId, kind: "instructions" },
    },
    {
      name: "getResource",
      input: { userId, projectId, resourceId },
    },
    {
      name: "attachConversation",
      input: { userId, projectId, conversationId },
    },
    {
      name: "listProjectConversations",
      input: { userId, projectId },
    },
    {
      name: "detachConversation",
      input: { userId, projectId, conversationId },
    },
  ]);
});

test("Projects API maps version conflicts, not found, invalid identity, and auth", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    service.failure =
      new ProjectWorkspaceServiceError("VERSION_CONFLICT");
    const conflict = await fetch(
      `${baseUrl}/projects/${projectId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version: 1,
          name: "Changed",
        }),
      },
    );
    assert.equal(conflict.status, 409);

    service.failure =
      new ProjectWorkspaceServiceError("PROJECT_NOT_FOUND");
    assert.equal(
      (await fetch(`${baseUrl}/projects/${projectId}`)).status,
      404,
    );

    service.failure = null;
    const identity = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Bad",
        user_id: userId,
      }),
    });
    assert.equal(identity.status, 400);
  });

  await withServer(
    service,
    async (baseUrl) => {
      assert.equal(
        (await fetch(`${baseUrl}/workspaces`)).status,
        401,
      );
    },
    false,
  );
});
