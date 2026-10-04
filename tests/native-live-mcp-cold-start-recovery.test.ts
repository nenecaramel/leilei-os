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
  const promptMessages: unknown[] = [];

  const handle = await createAgentSdkTurnHandle({
    prompt: "cold start message",
    environment: {},
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
      return {
        close() {},
        async mcpServerStatus() {
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
        },
        async *[Symbol.asyncIterator]() {
          for await (const message of prompt) {
            promptMessages.push(message);
          }
          yield* successMessages("provider-mcp-cold-start");
        },
      };
    },
  });

  assert.equal(queryCalls, 1);
  assert.equal(reconnectCalls, 3);

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
