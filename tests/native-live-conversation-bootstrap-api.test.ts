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
  renameCalls: unknown[] = [];
  renameOutcome: {
    id: string;
    title: string | null;
    currentHeadMessageId: string | null;
    lastMessageAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null = {
    id: conversationId,
    title: "Renamed",
    currentHeadMessageId: null,
    lastMessageAt: null,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T01:30:00.000Z",
  };
  archiveCalls: unknown[] = [];
  archiveOutcome:
    | { outcome: "archived"; archivedAt: string }
    | { outcome: "already_archived"; archivedAt: string }
    | { outcome: "busy" }
    | { outcome: "not_found" } = {
      outcome: "archived",
      archivedAt: "2026-09-24T02:00:00.000Z",
    };
  restoreCalls: unknown[] = [];
  restoreOutcome:
    | { outcome: "restored" }
    | { outcome: "already_active" }
    | { outcome: "not_found" } = { outcome: "restored" };
  deleteCalls: unknown[] = [];
  deleteOutcome:
    | { outcome: "deleted" }
    | { outcome: "busy" }
    | { outcome: "not_found" } = { outcome: "deleted" };

  async listConversations(input: unknown) {
    return (await this.listConversationPage(input)).conversations;
  }

  async listConversationPage(input: unknown) {
    this.listCalls.push(input);
    return {
      conversations: [{
        id: conversationId,
        title: "Existing",
        currentHeadMessageId: null,
        lastMessageAt: "2026-09-24T00:30:00.000Z",
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T01:00:00.000Z",
      }],
      nextCursor: "next-page",
    };
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

  async renameConversation(input: {
    userId: string;
    conversationId: string;
    title: string;
  }) {
    this.renameCalls.push(input);
    return this.renameOutcome;
  }

  async archiveConversation(input: {
    userId: string;
    conversationId: string;
  }) {
    this.archiveCalls.push(input);
    return this.archiveOutcome;
  }

  async restoreConversation(input: {
    userId: string;
    conversationId: string;
  }) {
    this.restoreCalls.push(input);
    return this.restoreOutcome;
  }

  async deleteConversation(input: {
    userId: string;
    conversationId: string;
  }) {
    this.deleteCalls.push(input);
    return this.deleteOutcome;
  }
}

async function withServer(
  conversationService: FakeConversationService,
  callback: (baseUrl: string) => Promise<void>,
  authenticated = true,
  currentPathReader?: {
    readCurrentPath(input: unknown): Promise<unknown>;
  },
  conversationRuntimeMetadataReader?: {
    readLatest(input: unknown): Promise<unknown>;
  },
  conversationHeadWaitService?: {
    wait(input: unknown): Promise<unknown>;
  },
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
      currentPathReader: currentPathReader as never,
      conversationRuntimeMetadataReader:
        conversationRuntimeMetadataReader as never,
      conversationHeadWaitService:
        conversationHeadWaitService as never,
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
      data: {
        conversations: Array<Record<string, unknown>>;
        nextCursor: string | null;
      };
    };
    assert.equal(payload.data.conversations.length, 1);
    assert.equal(payload.data.nextCursor, "next-page");
    assert.equal(payload.data.conversations[0]?.id, conversationId);
    assert.equal(
      payload.data.conversations[0]?.lastMessageAt,
      "2026-09-24T00:30:00.000Z",
    );
    assert.equal("userId" in (payload.data.conversations[0] ?? {}), false);
    assert.deepEqual(service.listCalls, [{ userId, limit: 2 }]);
  });
});

test("native live bootstrap forwards an opaque pagination cursor", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations?limit=2&cursor=opaque-next`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(service.listCalls, [{
      userId,
      limit: 2,
      cursor: "opaque-next",
    }]);
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

test("native live current path forwards delta cursor and returns pagination metadata", async () => {
  const service = new FakeConversationService();
  const calls: unknown[] = [];
  await withServer(
    service,
    async (baseUrl) => {
      const afterMessageId = "66666666-6666-4666-8666-666666666666";
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?limit=25&after_message_id=${afterMessageId}`,
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        data: {
          olderCursor: string | null;
          resetRequired: boolean;
          messages: unknown[];
        };
      };
      assert.equal(payload.data.olderCursor, null);
      assert.equal(payload.data.resetRequired, false);
      assert.equal(payload.data.messages.length, 0);
      assert.deepEqual(calls, [{
        userId,
        conversationId,
        limit: 25,
        afterMessageId,
      }]);
    },
    true,
    {
      async readCurrentPath(input: unknown) {
        calls.push(input);
        return {
          conversationId,
          title: "Existing",
          currentHeadMessageId: "77777777-7777-4777-8777-777777777777",
          updatedAt: "2026-09-26T08:00:00.000Z",
          syncToken: "head:77777777-7777-4777-8777-777777777777",
          truncated: false,
          olderCursor: null,
          resetRequired: false,
          messages: [],
        };
      },
    },
  );
});

test("native live current path rejects simultaneous older and delta cursors", async () => {
  const service = new FakeConversationService();
  await withServer(
    service,
    async (baseUrl) => {
      const beforeMessageId = "66666666-6666-4666-8666-666666666666";
      const afterMessageId = "77777777-7777-4777-8777-777777777777";
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path?before_message_id=${beforeMessageId}&after_message_id=${afterMessageId}`,
      );
      assert.equal(response.status, 400);
    },
    true,
    {
      async readCurrentPath() {
        throw new Error("must not be called");
      },
    },
  );
});

test("native live conversation head wait is owner-scoped and carries only the head cursor", async () => {
  const service = new FakeConversationService();
  const calls: unknown[] = [];
  const headMessageId =
    "77777777-7777-4777-8777-777777777777";

  await withServer(
    service,
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/head/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            after_head_message_id: headMessageId,
          }),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        success: true,
        data: {
          outcome: "changed",
          currentHeadMessageId:
            "88888888-8888-4888-8888-888888888888",
        },
      });
      const firstCall = calls[0] as {
        userId: string;
        conversationId: string;
        afterHeadMessageId: string | null;
        timeoutMs: number;
        signal?: unknown;
      };
      assert.deepEqual(
        {
          userId: firstCall.userId,
          conversationId: firstCall.conversationId,
          afterHeadMessageId:
            firstCall.afterHeadMessageId,
          timeoutMs: firstCall.timeoutMs,
        },
        {
          userId,
          conversationId,
          afterHeadMessageId: headMessageId,
          timeoutMs: 25_000,
        },
      );
      assert.ok(firstCall.signal instanceof AbortSignal);

      const empty = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/head/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            after_head_message_id: null,
          }),
        },
      );
      assert.equal(empty.status, 200);
      assert.equal(
        (calls[1] as { afterHeadMessageId: unknown })
          .afterHeadMessageId,
        null,
      );

      const malformed = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/head/wait`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            after_head_message_id: "not-a-uuid",
          }),
        },
      );
      assert.equal(malformed.status, 400);
      assert.equal(calls.length, 2);
    },
    true,
    undefined,
    undefined,
    {
      async wait(input: unknown) {
        calls.push(input);
        return {
          outcome: "changed",
          currentHeadMessageId:
            "88888888-8888-4888-8888-888888888888",
        };
      },
    },
  );
});

test("native live conversation runtime metadata is read authoritatively by current conversation", async () => {
  const service = new FakeConversationService();
  const calls: unknown[] = [];
  await withServer(
    service,
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/runtime-metadata`,
      );
      assert.equal(response.status, 200);
      const payload = await response.json() as {
        data: Record<string, unknown>;
      };
      assert.deepEqual(payload.data, {
        conversationId,
        currentHeadMessageId:
          "77777777-7777-4777-8777-777777777777",
        sourceMessageId:
          "77777777-7777-4777-8777-777777777777",
        effectiveWorkingDirectory:
          "/Users/leilei/Projects/runtime-metadata",
        runtimeMetadata: {
          context_usage: {
            percentage: 12,
          },
        },
        observedAt: "2026-09-27T08:00:00.000Z",
      });
      assert.deepEqual(calls, [{ userId, conversationId }]);

      const invalid = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/not-a-uuid/runtime-metadata`,
      );
      assert.equal(invalid.status, 400);
      assert.equal(calls.length, 1);
    },
    true,
    undefined,
    {
      async readLatest(input: unknown) {
        calls.push(input);
        return {
          conversationId,
          currentHeadMessageId:
            "77777777-7777-4777-8777-777777777777",
          sourceMessageId:
            "77777777-7777-4777-8777-777777777777",
          effectiveWorkingDirectory:
            "/Users/leilei/Projects/runtime-metadata",
          runtimeMetadata: {
            context_usage: {
              percentage: 12,
            },
          },
          observedAt: "2026-09-27T08:00:00.000Z",
        };
      },
    },
  );
});

test("native live conversation runtime metadata returns not found without fabricating state", async () => {
  const service = new FakeConversationService();
  await withServer(
    service,
    async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/runtime-metadata`,
      );
      assert.equal(response.status, 404);
    },
    true,
    undefined,
    {
      async readLatest() {
        return null;
      },
    },
  );
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

test("native live bootstrap lists archived conversations through explicit scope", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations?scope=archived&limit=2`,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(service.listCalls, [{
      userId,
      limit: 2,
      scope: "archived",
    }]);

    const invalid = await fetch(
      `${baseUrl}/api/v1/native-live/conversations?scope=deleted`,
    );
    assert.equal(invalid.status, 400);
  });
});

test("native live bootstrap archives and restores an owner conversation", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const archived = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/archive`,
      { method: "POST" },
    );
    assert.equal(archived.status, 204);
    assert.deepEqual(service.archiveCalls, [{ userId, conversationId }]);

    const restored = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/restore`,
      { method: "POST" },
    );
    assert.equal(restored.status, 204);
    assert.deepEqual(service.restoreCalls, [{ userId, conversationId }]);
  });
});

test("native live archive rejects busy and restore rejects missing", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    service.archiveOutcome = { outcome: "busy" };
    const busy = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/archive`,
      { method: "POST" },
    );
    assert.equal(busy.status, 409);

    service.restoreOutcome = { outcome: "not_found" };
    const missing = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/restore`,
      { method: "POST" },
    );
    assert.equal(missing.status, 404);
  });
});

test("native live true delete requires explicit confirmation", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const unconfirmed = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}`,
      { method: "DELETE" },
    );
    assert.equal(unconfirmed.status, 400);
    assert.equal(service.deleteCalls.length, 0);

    const confirmed = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}?confirm=true`,
      { method: "DELETE" },
    );
    assert.equal(confirmed.status, 204);
    assert.deepEqual(service.deleteCalls, [{ userId, conversationId }]);
  });
});

test("native live true delete rejects busy, missing, and invalid ids", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    service.deleteOutcome = { outcome: "busy" };
    const busy = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}?confirm=true`,
      { method: "DELETE" },
    );
    assert.equal(busy.status, 409);

    service.deleteOutcome = { outcome: "not_found" };
    const missing = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}?confirm=true`,
      { method: "DELETE" },
    );
    assert.equal(missing.status, 404);

    const invalid = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/not-a-uuid?confirm=true`,
      { method: "DELETE" },
    );
    assert.equal(invalid.status, 400);
    assert.equal(service.deleteCalls.length, 2);
  });
});

test("native live bootstrap renames an owner conversation and trims title", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "  Renamed  " }),
      },
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      data: { title: string | null };
    };
    assert.equal(payload.data.title, "Renamed");
    assert.deepEqual(service.renameCalls, [{
      userId,
      conversationId,
      title: "Renamed",
    }]);
  });
});

test("native live bootstrap rename rejects missing, blank, invalid, and extra fields", async () => {
  const service = new FakeConversationService();
  await withServer(service, async (baseUrl) => {
    service.renameOutcome = null;
    const missing = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Missing" }),
      },
    );
    assert.equal(missing.status, 404);

    const blank = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "   " }),
      },
    );
    assert.equal(blank.status, 400);

    const extra = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Okay", extra: true }),
      },
    );
    assert.equal(extra.status, 400);

    const invalidId = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/not-a-uuid`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Okay" }),
      },
    );
    assert.equal(invalidId.status, 400);
    assert.equal(service.renameCalls.length, 1);
  });
});

test("native live current-path ETag changes when activity changes under the same head", async () => {
  const service = new FakeConversationService();
  const headMessageId = "77777777-7777-4777-8777-777777777777";
  let sequence = 1;
  let durationMs: number | undefined;
  let interactionUpdatedAt =
    "2026-09-26T08:00:00.750Z";

  const reader = {
    async readCurrentPath() {
      return {
        conversationId,
        title: "Existing",
        currentHeadMessageId: headMessageId,
        updatedAt: "2026-09-26T08:00:00.000Z",
        syncToken: `head:${headMessageId}`,
        truncated: false,
        olderCursor: null,
        resetRequired: false,
        messages: [{
          id: headMessageId,
          conversationId,
          parentMessageId:
            "66666666-6666-4666-8666-666666666666",
          role: "assistant",
          status: "completed",
          createdAt: "2026-09-26T08:00:00.000Z",
          completedAt: "2026-09-26T08:00:01.000Z",
          blocks: [],
          activity: {
            durationMs,
            prepareId:
              "88888888-8888-4888-8888-888888888888",
            events: [{
              sequence,
              event: {
                type: "task",
                payload: {
                  phase: "progress",
                  task_id: "task-1",
                },
              },
              createdAt: "2026-09-26T08:00:00.500Z",
            }],
            interactions: [{
              interactionId:
                "99999999-9999-4999-8999-999999999999",
              prepareId:
                "88888888-8888-4888-8888-888888888888",
              kind: "permission",
              request: { toolName: "Bash" },
              status: "pending",
              response: null,
              createdAt: "2026-09-26T08:00:00.700Z",
              updatedAt: interactionUpdatedAt,
              resolvedAt: null,
              cancelledAt: null,
            }],
          },
        }],
      };
    },
  };

  await withServer(
    service,
    async (baseUrl) => {
      const url =
        `${baseUrl}/api/v1/native-live/conversations/${conversationId}/current-path`;

      const first = await fetch(url);
      assert.equal(first.status, 200);
      const firstEtag = first.headers.get("etag");
      assert.ok(firstEtag);

      sequence = 2;
      const changed = await fetch(url, {
        headers: {
          "If-None-Match": firstEtag,
        },
      });
      assert.equal(changed.status, 200);
      const changedEtag = changed.headers.get("etag");
      assert.ok(changedEtag);
      assert.notEqual(changedEtag, firstEtag);

      interactionUpdatedAt =
        "2026-09-26T08:00:02.000Z";
      const interactionChanged = await fetch(url, {
        headers: {
          "If-None-Match": changedEtag,
        },
      });
      assert.equal(interactionChanged.status, 200);
      const interactionChangedEtag =
        interactionChanged.headers.get("etag");
      assert.ok(interactionChangedEtag);
      assert.notEqual(interactionChangedEtag, changedEtag);

      durationMs = 18000;
      const durationChanged = await fetch(url, {
        headers: { "If-None-Match": interactionChangedEtag },
      });
      assert.equal(durationChanged.status, 200);
      const durationEtag = durationChanged.headers.get("etag");
      assert.ok(durationEtag);
      assert.notEqual(durationEtag, interactionChangedEtag);
      const durationBody = await durationChanged.json() as { data: { messages: Array<{ activity: { durationMs: number } }> } };
      assert.equal(durationBody.data.messages[0]?.activity.durationMs, 18000);

      const unchanged = await fetch(url, {
        headers: {
          "If-None-Match": durationEtag,
        },
      });
      assert.equal(unchanged.status, 304);
    },
    true,
    reader,
  );
});
