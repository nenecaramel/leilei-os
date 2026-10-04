import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSdkTurnHandle,
} from "../tools/claude-bridge/src/agent-sdk-turn-handle.mjs";

function successMessages(sessionId: string) {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
    },
    {
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [{ type: "text", text: "READY" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: "READY",
    },
  ];
}

test("Native Live keeps one Agent SDK turn alive across repeated MCP cold-start reconnects", async () => {
  let queryCalls = 0;
  let reconnectCalls = 0;
  let mcpReady = false;
  let promptsBeforeReady = 0;
  const promptMessages: unknown[] = [];

  const handle = await createAgentSdkTurnHandle({
    prompt: "cold start message",
    environment: {},
    streaming: true,
    mcpStartupTimeoutMs: 2_000,
    queryOptions: {
      mcpServers: {
        leileios: {
          type: "http",
          url: "https://leilei-os.example/internal/native-live-mcp",
          headers: {
            Authorization: "Bearer relay-secret",
          },
        },
      },
    },
    queryImpl: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
      queryCalls += 1;
      // The real SDK starts consuming input inside query(), not handle.start().
      const inputConsumed = (async () => {
        for await (const message of prompt) {
          promptMessages.push(message);
          if (!mcpReady) promptsBeforeReady += 1;
        }
      })();
      return {
        close() {},
        async mcpServerStatus() {
          mcpReady = reconnectCalls >= 3;
          return [{
            name: "leileios",
            status: reconnectCalls >= 3 ? "connected" : "failed",
            ...(reconnectCalls >= 3
              ? {}
              : { error: "database is still waking" }),
          }];
        },
        async reconnectMcpServer(name: string) {
          assert.equal(name, "leileios");
          reconnectCalls += 1;
          if (reconnectCalls < 3) {
            throw new Error("database is still waking");
          }
        },
        async *[Symbol.asyncIterator]() {
          await inputConsumed;
          yield* successMessages("provider-mcp-cold-start");
        },
      };
    },
  });

  assert.equal(queryCalls, 1);
  assert.equal(reconnectCalls, 3);
  assert.equal(promptsBeforeReady, 0);

  const result = await handle.start();

  assert.equal(result.providerSessionId, "provider-mcp-cold-start");
  assert.equal(queryCalls, 1);
  assert.equal(promptMessages.length, 1);
  assert.equal(
    (
      promptMessages[0] as {
        message?: { content?: Array<{ text?: string }> };
      }
    )?.message?.content?.[0]?.text,
    "cold start message",
  );
});
