import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { NativeLiveConversation } from "../src/domains/conversation/native-live-conversation-types.js";
import { createNativeLiveApiRouter } from "../src/web-api/native-live-router.js";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "55555555-5555-4555-8555-555555555555";

class FakeConversationService {
  listCalls: unknown[] = [];
  createCalls: unknown[] = [];

  async listConversations(input: unknown) {
    this.listCalls.push(input);
    return [{
      id: conversationId,
      title: "Existing",
      currentHeadMessageId: null,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T01:00:00.000Z",
    }];
  }

  async createConversation(input: {
    userId: string;
    title?: string | null;
  }): Promise<NativeLiveConversation> {
    this.createCalls.push(input);
    return {
      id: conversationId,
      userId: input.userId,
      title: input.title ?? null,
      lifecycleStatus: "active",
      currentHeadMessageId: null,
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T00:00:00.000Z",
      messages: [],
    };
  }
}

async function withServer(
  conversationService: FakeConversationService,
  callback: (baseUrl: string) => Promise<void>,
  authenticated = true,
): Promise<void> {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((request, _response, next) => {
      request.webUserId = userId;
      next();
    });
  }
  app.use(
    "/api/v1/native-live",
    createNativeLiveApiRouter({
      coordinator: {
        async prepare() {
          throw new Error("unused");
        },
      },
      relayService: {
        async enqueuePreparation() {},
      },
      turnReader: {
        async readTurn() {
          return null;
        },
      },
      conversationService,
    }),
  );

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("native live bootstrap lists owner-scoped active summaries with a bounded limit", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations?limit=2`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      data: { conversations: Array<Record<string, unknown>> };
    };
    assert.equal(payload.data.conversations.length, 1);
    assert.equal(payload.data.conversations[0]?.id, conversationId);
    assert.equal("userId" in (payload.data.conversations[0] ?? {}), false);
    assert.deepEqual(service.listCalls, [{ userId, limit: 2 }]);
  });
});

test("native live bootstrap defaults list limit and rejects an invalid limit", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const ok = await fetch(
      `${baseUrl}/api/v1/native-live/conversations`,
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(service.listCalls, [{ userId, limit: 50 }]);

    const invalid = await fetch(
      `${baseUrl}/api/v1/native-live/conversations?limit=0`,
    );
    assert.equal(invalid.status, 400);
    assert.equal(service.listCalls.length, 1);
  });
});

test("native live bootstrap creates for the authenticated owner and trims title", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "  New chat  " }),
      },
    );
    assert.equal(response.status, 201);
    const payload = await response.json() as {
      data: Record<string, unknown>;
    };
    assert.equal(payload.data.id, conversationId);
    assert.equal(payload.data.title, "New chat");
    assert.equal("userId" in payload.data, false);
    assert.deepEqual(service.createCalls, [{
      userId,
      title: "New chat",
    }]);
  });
});

test("native live bootstrap rejects blank titles and unauthenticated access", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const invalid = await fetch(
      `${baseUrl}/api/v1/native-live/conversations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "   " }),
      },
    );
    assert.equal(invalid.status, 400);
    assert.equal(service.createCalls.length, 0);
  });

  await withServer(
    service,
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations`,
      );
      assert.equal(response.status, 401);
    },
    false,
  );
});
