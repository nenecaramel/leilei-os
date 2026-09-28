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

  async listProductWorkspaces(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listProductWorkspaces", input });
    return [];
  }
  async getProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "getProductWorkspace", input });
    return { id: projectId, name: "LeileiOS", version: 1 };
  }
  async createProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createProductWorkspace", input });
    return { id: projectId, name: "LeileiOS", version: 1 };
  }
  async updateProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateProductWorkspace", input });
    return { id: projectId, name: "Changed", version: 2 };
  }
  async deleteProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "deleteProductWorkspace", input });
  }
  async listWorkspaceResources(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listWorkspaceResources", input });
    return [];
  }
  async getWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "getWorkspaceResource", input });
    return { id: resourceId, workspaceId: projectId, content: "detail" };
  }
  async createWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createWorkspaceResource", input });
    return { id: resourceId, workspaceId: projectId };
  }
  async updateWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateWorkspaceResource", input });
    return { id: resourceId, workspaceId: projectId, version: 2 };
  }
  async deleteWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "deleteWorkspaceResource", input });
  }
  async listWorkspaceConversations(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "listWorkspaceConversations", input });
    return [];
  }
  async attachWorkspaceConversation(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "attachWorkspaceConversation", input });
    return { applied: true };
  }
  async detachWorkspaceConversation(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "detachWorkspaceConversation", input });
    return { applied: true };
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

test("Workspaces API exposes one execution Workspace surface and keeps legacy aliases", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/workspaces`)).status, 200);

    const workspaceCreate = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "workspace-create-api-0001",
      },
      body: JSON.stringify({ name: "LeileiOS" }),
    });
    assert.equal(workspaceCreate.status, 201);
    assert.equal(
      (await workspaceCreate.json()).data.id,
      projectId,
      "product Workspace id must be the execution id",
    );

    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces?conversation_id=${conversationId}`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(`${baseUrl}/workspaces/${projectId}`)).status,
      200,
    );

    const resourceCreate = await fetch(
      `${baseUrl}/workspaces/${projectId}/resources`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "workspace-resource-api-0001",
        },
        body: JSON.stringify({
          kind: "instructions",
          key: "default",
          content: "Use the Workspace context.",
        }),
      },
    );
    assert.equal(resourceCreate.status, 201);
    const resourceBody = await resourceCreate.json();
    assert.equal(resourceBody.data.workspaceId, projectId);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        resourceBody.data,
        "projectId",
      ),
      false,
    );

    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${projectId}/resources?kind=instructions`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${projectId}/resources/${resourceId}`,
      )).status,
      200,
    );

    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${projectId}/conversations/${conversationId}`,
        { method: "PUT" },
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${projectId}/conversations`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${projectId}/conversations/${conversationId}`,
        { method: "DELETE" },
      )).status,
      200,
    );

    // Transition compatibility: old backing containers moved under an
    // explicit legacy path and the existing /projects alias remains.
    assert.equal(
      (await fetch(`${baseUrl}/legacy/project-workspaces`)).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/projects?workspace_id=${workspaceId}`,
      )).status,
      200,
    );
  });

  assert.deepEqual(service.calls, [
    {
      name: "listProductWorkspaces",
      input: { userId },
    },
    {
      name: "createProductWorkspace",
      input: {
        userId,
        name: "LeileiOS",
        description: undefined,
        idempotencyKey: "workspace-create-api-0001",
      },
    },
    {
      name: "listProductWorkspaces",
      input: { userId, conversationId },
    },
    {
      name: "getProductWorkspace",
      input: { userId, workspaceId: projectId },
    },
    {
      name: "createWorkspaceResource",
      input: {
        userId,
        workspaceId: projectId,
        kind: "instructions",
        key: "default",
        title: undefined,
        content: "Use the Workspace context.",
        metadata: undefined,
        idempotencyKey: "workspace-resource-api-0001",
      },
    },
    {
      name: "listWorkspaceResources",
      input: {
        userId,
        workspaceId: projectId,
        kind: "instructions",
      },
    },
    {
      name: "getWorkspaceResource",
      input: {
        userId,
        workspaceId: projectId,
        resourceId,
      },
    },
    {
      name: "attachWorkspaceConversation",
      input: {
        userId,
        workspaceId: projectId,
        conversationId,
      },
    },
    {
      name: "listWorkspaceConversations",
      input: { userId, workspaceId: projectId },
    },
    {
      name: "detachWorkspaceConversation",
      input: {
        userId,
        workspaceId: projectId,
        conversationId,
      },
    },
    { name: "listWorkspaces", input: userId },
    {
      name: "listProjects",
      input: { userId, workspaceId },
    },
  ]);
});

test("Workspaces API maps version conflicts, not found, invalid identity, and auth", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    service.failure =
      new ProjectWorkspaceServiceError("VERSION_CONFLICT");
    const conflict = await fetch(
      `${baseUrl}/workspaces/${projectId}`,
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
      new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    assert.equal(
      (await fetch(`${baseUrl}/workspaces/${projectId}`)).status,
      404,
    );

    service.failure =
      new ProjectWorkspaceServiceError("WORKSPACE_IN_USE");
    const inUse = await fetch(
      `${baseUrl}/workspaces/${projectId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    assert.equal(inUse.status, 409);
    assert.equal((await inUse.json()).error.code, "WORKSPACE_IN_USE");

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
