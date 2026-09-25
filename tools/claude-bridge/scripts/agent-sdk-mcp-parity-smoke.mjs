import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this smoke verifies the existing Claude subscription login.",
  );
}

const sentinel =
  "LEILEIOS_MCP_" + randomUUID().replaceAll("-", "").slice(0, 16);
const serverKey = "leileios_parity";
const toolName = "read_sentinel";
const qualifiedToolName =
  "mcp__" + serverKey + "__" + toolName;
let handlerCalls = 0;

const parityTool = tool(
  toolName,
  "Return the hidden LeileiOS MCP parity sentinel. Use this tool whenever the user asks for the MCP parity sentinel.",
  {},
  async () => {
    handlerCalls += 1;
    return {
      content: [{
        type: "text",
        text: sentinel,
      }],
    };
  },
);

const server = createSdkMcpServer({
  name: serverKey,
  version: "1.0.0",
  tools: [parityTool],
});

function assistantToolNames(message) {
  if (message?.type !== "assistant") return [];
  return (message.message?.content ?? [])
    .filter((block) => block?.type === "tool_use")
    .map((block) => block.name)
    .filter((value) => typeof value === "string");
}

async function run() {
  const messages = [];
  for await (const message of query({
    prompt: [
      "This is a deterministic LeileiOS Agent SDK MCP parity smoke.",
      "Use the MCP tool named " + qualifiedToolName + " exactly once.",
      "The sentinel is hidden inside the tool; do not guess it.",
      "After the tool returns, reply with exactly its returned sentinel and nothing else.",
    ].join("\n"),
    options: {
      cwd: process.cwd(),
      env: process.env,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      mcpServers: {
        [serverKey]: server,
      },
      allowedTools: [qualifiedToolName],
    },
  })) {
    messages.push(message);
  }

  const toolNames = messages.flatMap(assistantToolNames);
  assert.equal(
    handlerCalls,
    1,
    "in-process MCP handler was not called exactly once.",
  );
  assert.ok(
    toolNames.includes(qualifiedToolName),
    "SDK stream did not expose the qualified MCP tool call.",
  );

  const result = [...messages]
    .reverse()
    .find((message) => message?.type === "result");
  assert.ok(result, "SDK stream emitted no terminal result.");
  assert.equal(
    result.result?.trim(),
    sentinel,
    "Claude did not return the hidden MCP sentinel exactly.",
  );

  process.stdout.write(
    JSON.stringify(
      {
        outcome: "PASS",
        sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
        auth: "existing_claude_subscription_login",
        capability: "in_process_sdk_mcp",
        serverKey,
        qualifiedToolName,
        handlerCalls,
      },
      null,
      2,
    ) + "\n",
  );
}

run().catch((error) => {
  process.stderr.write(
    JSON.stringify(
      {
        outcome: "FAIL",
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
