import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createMindApiRouter,
  type MindApiDependencies,
} from "../src/web-api/mind-router.js";
import {
  MindProductServiceError,
} from "../src/domains/runtime/mind/mind-product-service.js";

const userId = "11111111-1111-4111-8111-111111111111";
const stateId = "22222222-2222-4222-8222-222222222222";
const messageId = "33333333-3333-4333-8333-333333333333";

class FakeMindService {
  calls: Array<{ name: string; input: unknown }> = [];
  failure: MindProductServiceError | null = null;

  private maybeFail() {
    if (this.failure) throw this.failure;
  }

  async list(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "list", input });
    return { items: [], nextCursor: null };
  }

  async get(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "get", input });
    return { id: stateId };
  }

  async createManual(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "create", input });
    return { id: stateId };
  }

  async delete(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "delete", input });
    return { deletedStateCount: 1 };
  }

  async readMessageWrites(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "writes", input });
    return { messageId, total: 0, kinds: [] };
  }
}

async function withServer(
  service: FakeMindService,
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
    "/mind",
    createMindApiRouter({
      mindService:
        service as unknown as MindApiDependencies["mindService"],
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    await work(`http://127.0.0.1:${address.port}/mind`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("Mind API lists, creates, deletes, and reads message write projection", async () => {
  const service = new FakeMindService();
  await withServer(service, async (baseUrl) => {
    const list = await fetch(`${baseUrl}?kind=memory&limit=25`);
    assert.equal(list.status, 200);

    const create = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "mind-manual-api-0001",
      },
      body: JSON.stringify({
        kind: "memory",
        text: "old record",
        occurred_at: "2025-01-01T00:00:00Z",
        note: "manual",
      }),
    });
    assert.equal(create.status, 201);

    const detail = await fetch(`${baseUrl}/${stateId}`);
    assert.equal(detail.status, 200);

    const writes = await fetch(
      `${baseUrl}/writes/messages/${messageId}`,
    );
    assert.equal(writes.status, 200);

    const deletion = await fetch(`${baseUrl}/${stateId}`, {
      method: "DELETE",
    });
    assert.equal(deletion.status, 200);

    assert.deepEqual(service.calls, [
      {
        name: "list",
        input: { userId, kind: "memory", limit: 25 },
      },
      {
        name: "create",
        input: {
          userId,
          kind: "memory",
          text: "old record",
          occurredAt: "2025-01-01T00:00:00Z",
          note: "manual",
          idempotencyKey: "mind-manual-api-0001",
        },
      },
      {
        name: "get",
        input: { userId, stateId },
      },
      {
        name: "writes",
        input: { userId, messageId },
      },
      {
        name: "delete",
        input: { userId, stateId },
      },
    ]);
  });
});

test("Mind API maps durable create idempotency failures", async () => {
  const service = new FakeMindService();
  await withServer(service, async (baseUrl) => {
    service.failure =
      new MindProductServiceError("IDEMPOTENCY_CONFLICT");
    const conflict = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "mind-manual-api-0001",
      },
      body: JSON.stringify({
        kind: "memory",
        text: "different",
      }),
    });
    assert.equal(conflict.status, 409);
    assert.equal(
      (await conflict.json()).error.code,
      "IDEMPOTENCY_CONFLICT",
    );

    service.failure =
      new MindProductServiceError("INVALID_IDEMPOTENCY_KEY");
    const invalid = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "memory",
        text: "remember",
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(
      (await invalid.json()).error.code,
      "INVALID_IDEMPOTENCY_KEY",
    );
  });
});

test("Mind API rejects client identity, unsupported fields, and unauthenticated access", async () => {
  const service = new FakeMindService();
  await withServer(service, async (baseUrl) => {
    const identity = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "memory",
        text: "x",
        user_id: userId,
      }),
    });
    assert.equal(identity.status, 400);

    const extra = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "memory",
        text: "x",
        extra: true,
      }),
    });
    assert.equal(extra.status, 400);

    const badKind = await fetch(`${baseUrl}?kind=dream`);
    assert.equal(badKind.status, 400);
    assert.equal(service.calls.length, 0);
  });

  await withServer(
    service,
    async (baseUrl) => {
      const response = await fetch(baseUrl);
      assert.equal(response.status, 401);
    },
    false,
  );
});


test("manual API rejects retired Mind kinds before calling the writer", async () => {
  const service = new FakeMindService();
  await withServer(service, async baseUrl => {
    for (const kind of ["thought", "feel"]) {
      const response = await fetch(baseUrl, {method:"POST", headers:{"Content-Type":"application/json","Idempotency-Key":"legacy-mind-create-001"}, body:JSON.stringify({kind,text:"keep emotional context"})});
      assert.equal(response.status,400);
    }
    assert.deepEqual(service.calls,[]);
  });
});
