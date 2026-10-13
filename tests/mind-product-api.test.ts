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

  async listDates(input: unknown) { this.calls.push({name:"dates",input}); return {dates:["2026-10-08"]}; }

  async list(input: unknown) {
    this.maybeFail();
    this.calls.push({ name: "list", input });
    return { items: [], nextCursor: null, totalCount: 37 };
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
    const listBody = await list.json() as {
      success: boolean;
      data: { items: unknown[]; nextCursor: string | null; totalCount: number };
    };
    assert.equal(listBody.data.items.length, 0);
    assert.equal(listBody.data.totalCount, 37);

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

test("Mind API accepts occurred-desc sorting and rejects unsupported sort values", async () => {
  const service = new FakeMindService();
  await withServer(service, async baseUrl => {
    assert.equal((await fetch(`${baseUrl}?kind=memory&sort=occurred_desc&limit=20`)).status, 200);
    assert.deepEqual(service.calls.at(-1), {
      name: "list",
      input: { userId, kind: "memory", sort: "occurred_desc", limit: 20 },
    });
    for (const invalid of ["newest", "", "occurred_desc&sort=updated_desc"]) {
      assert.equal((await fetch(`${baseUrl}?sort=${invalid}`)).status, 400);
    }
    assert.equal(service.calls.length, 1);
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

test("Mind search/day routes and PATCH share authenticated service and strict edit fields", async () => {
  const service = new FakeMindService();
  Object.assign(service, {
    search: async (input: unknown) => {
      service.calls.push({ name: "search", input });
      return { items: [], nextCursor: null };
    },
    readDay: async (input: unknown) => {
      service.calls.push({ name: "day", input });
      return { items: [], nextCursor: null };
    },
    update: async (input: unknown) => {
      service.calls.push({ name: "update", input });
      return { id: stateId };
    },
  });
  await withServer(service, async (base) => {
    assert.equal(
      (
        await fetch(
          `${base}/search?query=tea&undated=false&date_from=2026-10-08&date_to=2026-10-09&limit=2`,
        )
      ).status,
      200,
    );
    assert.equal(
      (service.calls.find((x) => x.name === "search")!.input as any).undated,
      false,
    );
    assert.equal((await fetch(`${base}/search?undated=true`)).status, 200);
    assert.equal(
      (service.calls.filter((x) => x.name === "search").at(-1)!.input as any)
        .undated,
      true,
    );
    assert.equal((await fetch(`${base}/search?undated=yes`)).status, 400);
    assert.equal((await fetch(`${base}/days/2026-10-08?limit=2`)).status, 200);
    const r = await fetch(`${base}/${stateId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "edited",
        occurred_at: null,
        expected_version: "a".repeat(64),
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
    const edit = service.calls.find((x) => x.name === "update")!.input as any;
    assert.equal(edit.userId, userId);
    assert.equal(edit.occurredAt, null);
    assert.equal(edit.expectedVersion, "a".repeat(64));
    for (const body of [
      { text: "edited", expected_version: "a".repeat(64), salience: 1 },
      { text: "edited", expected_version: "a".repeat(64), user_id: "foreign" },
    ])
      assert.equal(
        (
          await fetch(`${base}/${stateId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    service.failure = new MindProductServiceError("MIND_CONFLICT");
    Object.assign(service, {
      update: async () => {
        throw service.failure;
      },
    });
    assert.equal(
      (
        await fetch(`${base}/${stateId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: "edited",
            expected_version: "a".repeat(64),
          }),
        })
      ).status,
      409,
    );
  });
});


test("Memory dates are authenticated, no-store and routed before state IDs", async () => {
 const service = new FakeMindService();
 await withServer(service, async base => {
   const response = await fetch(base+"/dates");
   assert.equal(response.status,200);
   assert.match(response.headers.get("cache-control")!, /no-store/);
   assert.deepEqual((await response.json()).data,{dates:["2026-10-08"]});
   assert.deepEqual(service.calls,[{name:"dates",input:{userId}}]);
 });
 await withServer(new FakeMindService(), async base => assert.equal((await fetch(base+"/dates")).status,401),false);
});

test("Mind list forwards undated filter and preserves sort; invalid filter is rejected",async () => {
  const service = new FakeMindService();
  await withServer(service,async baseUrl => {
    assert.equal((await fetch(`${baseUrl}?kind=memory&sort=occurred_desc&undated=true`)).status,200);
    assert.deepEqual(service.calls.at(-1),{name:"list",input:{userId,kind:"memory",sort:"occurred_desc",undated:true}});
    assert.equal((await fetch(`${baseUrl}?undated=maybe`)).status,400);
  });
});
