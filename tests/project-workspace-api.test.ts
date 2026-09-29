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
const resourceId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";

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
    return { id: workspaceId, name: "LeileiOS", version: 1 };
  }

  async createProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createProductWorkspace", input });
    return { id: workspaceId, name: "LeileiOS", version: 1 };
  }

  async updateProductWorkspace(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateProductWorkspace", input });
    return { id: workspaceId, name: "Changed", version: 2 };
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
    return { id: resourceId, workspaceId, content: "detail" };
  }

  async createWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "createWorkspaceResource", input });
    return { id: resourceId, workspaceId };
  }

  async updateWorkspaceResource(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "updateWorkspaceResource", input });
    return { id: resourceId, workspaceId, version: 2 };
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

test("Workspaces API exposes only the single Workspace surface", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/workspaces`)).status, 200);

    const created = await fetch(`${baseUrl}/workspaces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "workspace-create-api-0001",
      },
      body: JSON.stringify({ name: "LeileiOS" }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).data.id, workspaceId);

    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces?conversation_id=${conversationId}`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(`${baseUrl}/workspaces/${workspaceId}`)).status,
      200,
    );

    const resourceCreate = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/resources`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "workspace-resource-api-0001",
        },
        body: JSON.stringify({
          kind: "instructions",
          key: "default",
          content: "Use Workspace context.",
        }),
      },
    );
    assert.equal(resourceCreate.status, 201);
    const resourceBody = await resourceCreate.json();
    assert.equal(resourceBody.data.workspaceId, workspaceId);
    assert.equal(Object.hasOwn(resourceBody.data, "projectId"), false);

    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${workspaceId}/resources/${resourceId}`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${workspaceId}/conversations/${conversationId}`,
        { method: "PUT" },
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${workspaceId}/conversations`,
      )).status,
      200,
    );
    assert.equal(
      (await fetch(
        `${baseUrl}/workspaces/${workspaceId}/conversations/${conversationId}`,
        { method: "DELETE" },
      )).status,
      200,
    );

    assert.equal(
      (await fetch(`${baseUrl}/legacy/project-workspaces`)).status,
      404,
    );
    assert.equal((await fetch(`${baseUrl}/projects`)).status, 404);
  });

  assert.deepEqual(
    service.calls.map((call) => call.name),
    [
      "listProductWorkspaces",
      "createProductWorkspace",
      "listProductWorkspaces",
      "getProductWorkspace",
      "createWorkspaceResource",
      "getWorkspaceResource",
      "attachWorkspaceConversation",
      "listWorkspaceConversations",
      "detachWorkspaceConversation",
    ],
  );
});

test("Workspaces API maps durable conflicts, not found, invalid identity, and auth", async () => {
  const service = new FakeService();
  await withServer(service, async (baseUrl) => {
    service.failure =
      new ProjectWorkspaceServiceError("VERSION_CONFLICT");
    const conflict = await fetch(
      `${baseUrl}/workspaces/${workspaceId}`,
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
      new ProjectWorkspaceServiceError("IDEMPOTENCY_CONFLICT");
    const idempotencyConflict = await fetch(
      `${baseUrl}/workspaces`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "workspace-create-api-0001",
        },
        body: JSON.stringify({ name: "Different" }),
      },
    );
    assert.equal(idempotencyConflict.status, 409);
    assert.equal(
      (await idempotencyConflict.json()).error.code,
      "IDEMPOTENCY_CONFLICT",
    );

    service.failure =
      new ProjectWorkspaceServiceError("WORKSPACE_NOT_FOUND");
    assert.equal(
      (await fetch(`${baseUrl}/workspaces/${workspaceId}`)).status,
      404,
    );

    service.failure =
      new ProjectWorkspaceServiceError("WORKSPACE_IN_USE");
    const inUse = await fetch(
      `${baseUrl}/workspaces/${workspaceId}`,
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
    assert.equal((await identity.json()).error.code, "INVALID_WORKSPACE");
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
