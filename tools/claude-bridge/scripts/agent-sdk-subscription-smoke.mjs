import assert from "node:assert/strict";
import process from "node:process";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it is intended to verify the existing Claude subscription login path.",
  );
}

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find((candidate) => candidate.type === "result");
  return typeof event?.payload?.final_text === "string"
    ? event.payload.final_text.trim()
    : null;
}

function requireProviderSession(result, label) {
  assert.ok(
    result.providerSessionId,
    `${label} did not return a provider session id.`,
  );
  return result.providerSessionId;
}

async function run() {
  const runtime = new AgentSdkClaudeTransport({
    cwd: process.cwd(),
  });

  const first = await runtime.sendNew(
    "Reply with exactly LEILEIOS_AGENT_SDK_NEW and nothing else. Do not use tools.",
  );
  const rootSessionId = requireProviderSession(first, "new");
  assert.equal(finalText(first), "LEILEIOS_AGENT_SDK_NEW");

  const resumed = await runtime.resume(
    rootSessionId,
    "Reply with exactly LEILEIOS_AGENT_SDK_RESUME and nothing else. Do not use tools.",
  );
  assert.equal(
    requireProviderSession(resumed, "resume"),
    rootSessionId,
    "resume changed provider session identity.",
  );
  assert.equal(
    finalText(resumed),
    "LEILEIOS_AGENT_SDK_RESUME",
  );

  const forked = await runtime.fork(
    rootSessionId,
    "Reply with exactly LEILEIOS_AGENT_SDK_FORK and nothing else. Do not use tools.",
  );
  const forkSessionId = requireProviderSession(forked, "fork");
  assert.notEqual(
    forkSessionId,
    rootSessionId,
    "fork reused the parent provider session id.",
  );
  assert.equal(
    finalText(forked),
    "LEILEIOS_AGENT_SDK_FORK",
  );

  process.stdout.write(
    JSON.stringify(
      {
        outcome: "PASS",
        sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
        auth: "existing_claude_subscription_login",
        new: {
          providerSessionId: rootSessionId,
          finalText: finalText(first),
        },
        resume: {
          providerSessionId: resumed.providerSessionId,
          finalText: finalText(resumed),
        },
        fork: {
          providerSessionId: forkSessionId,
          parentProviderSessionId: rootSessionId,
          finalText: finalText(forked),
        },
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
        runtimeCode:
          error && typeof error === "object" && "runtimeCode" in error
            ? error.runtimeCode
            : null,
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
