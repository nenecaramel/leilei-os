import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createNativeLiveApiRouter } from "../src/web-api/native-live-router.js";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "55555555-5555-4555-8555-555555555555";
const requestId = "22222222-2222-4222-8222-222222222222";
const sourceSessionId = "3c9137a0-34db-4389-bdd5-07888afc8a07";

class FakeExternalSessionBridge {
  createCalls: unknown[] = [];
  readCalls: unknown[] = [];
  snapshot: Record<string, unknown> | null = {
    conversationId,
    sourceProvider: "claude_code",
    sourceProviderSessionId: sourceSessionId,
    sourceLabel: "claude-main-branch.jsonl",
    timeZone: "Asia/Shanghai",
    messageCount: 2,
    firstMessageAt: "2026-09-24T06:30:03.856Z",
    lastMessageAt: "2026-09-24T06:30:09.069Z",
    createdAt: "2026-09-29T16:00:00.000Z",
    messages: [
      {
        ordinal: 0,
        role: "user",
        time: "2026-09-24T14:30:03.856+08:00",
        content: "Claude.",
      },
      {
        ordinal: 1,
        role: "assistant",
        time: "2026-09-24T14:30:09.069+08:00",
        content: "Hello!",
      },
    ],
  };

  async createListRequest() {
    throw new Error("unused");
  }

  async readListRequest() {
    throw new Error("unused");
  }

  async createConversationFromSession(input: unknown) {
    this.createCalls.push(input);
    return {
      id: conversationId,
      title: "Forked",
      currentHeadMessageId: null,
      lastMessageAt: null,
      createdAt: "2026-09-29T16:00:00.000Z",
      updatedAt: "2026-09-29T16:00:00.000Z",
    };
  }

  async readConversationHistorySnapshot(input: unknown) {
    this.readCalls.push(input);
    return this.snapshot;
  }
}

async function withServer(
  bridge: FakeExternalSessionBridge,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((request, _response, next) => {
    request.webUserId = userId;
    next();
  });
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
      externalSessionBridgeService: bridge as never,
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

test("fork creation accepts a read-only Claude history snapshot without canonical fields", async () => {
  const bridge = new FakeExternalSessionBridge();
  await withServer(bridge, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/from-claude-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          source_session_id: sourceSessionId,
          history_snapshot: {
            source_label: "claude-main-branch.jsonl",
            time_zone: "Asia/Shanghai",
            messages: [
              {
                role: "user",
                time: "2026-09-24T14:30:03.856+08:00",
                content: "Claude.",
              },
              {
                role: "assistant",
                time: "2026-09-24T14:30:09.069+08:00",
                content: "Hello!",
              },
            ],
          },
        }),
      },
    );

    assert.equal(response.status, 201);
    assert.equal(bridge.createCalls.length, 1);
    assert.deepEqual(bridge.createCalls[0], {
      userId,
      requestId,
      sourceSessionId,
      historySnapshot: {
        sourceLabel: "claude-main-branch.jsonl",
        timeZone: "Asia/Shanghai",
        messages: [
          {
            role: "user",
            time: "2026-09-24T14:30:03.856+08:00",
            content: "Claude.",
          },
          {
            role: "assistant",
            time: "2026-09-24T14:30:09.069+08:00",
            content: "Hello!",
          },
        ],
      },
    });
  });
});

test("fork creation rejects malformed history before touching the bridge", async () => {
  const bridge = new FakeExternalSessionBridge();
  await withServer(bridge, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/from-claude-session`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          source_session_id: sourceSessionId,
          history_snapshot: {
            messages: [{
              role: "tool",
              time: "not-a-time",
              content: "",
            }],
          },
        }),
      },
    );

    assert.equal(response.status, 400);
    const payload = await response.json() as {
      error: { code: string };
    };
    assert.equal(payload.error.code, "INVALID_HISTORY_SNAPSHOT");
    assert.equal(bridge.createCalls.length, 0);
  });
});

test("history snapshot read is owner-scoped through the bridge and returns 404 when absent", async () => {
  const bridge = new FakeExternalSessionBridge();
  await withServer(bridge, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/history-snapshot`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      data: { messageCount: number; sourceProviderSessionId: string };
    };
    assert.equal(payload.data.messageCount, 2);
    assert.equal(payload.data.sourceProviderSessionId, sourceSessionId);
    assert.deepEqual(bridge.readCalls, [{ userId, conversationId }]);

    bridge.snapshot = null;
    const missing = await fetch(
      `${baseUrl}/api/v1/native-live/conversations/${conversationId}/history-snapshot`,
    );
    assert.equal(missing.status, 404);
  });
});
