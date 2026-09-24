import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find((candidate) => candidate.type === "result");
  return typeof event?.payload?.final_text === "string"
    ? event.payload.final_text.trim()
    : "";
}

function requireApplied(result, expectedModel, expectedEffort, label) {
  assert.equal(
    result.executionReadbackError,
    null,
    `${label} execution readback failed: ${result.executionReadbackError}`,
  );
  assert.ok(
    result.executionReadback,
    `${label} did not return executionReadback.`,
  );
  assert.equal(
    result.executionReadback.applied.model,
    expectedModel,
    `${label} applied model did not match requested model.`,
  );
  assert.equal(
    result.executionReadback.applied.effort,
    expectedEffort,
    `${label} applied effort did not match requested effort.`,
  );
  return result.executionReadback;
}

function matchingModelInfo(readback, expectedModel) {
  return readback.supported_models.find(
    (model) =>
      model.value === expectedModel
      || model.display_name?.toLowerCase().includes(
        expectedModel.includes("sonnet") ? "sonnet 5" : "opus 5.5",
      ),
  ) ?? null;
}

async function run() {
  const cwd = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-model-readback-"),
  );

  try {
    const transport = new AgentSdkClaudeTransport({
      cwd,
      environment: process.env,
    });

    const sonnet = await transport.sendNew(
      "Reply with exactly LEILEIOS_SONNET5_XHIGH and nothing else. Do not use tools.",
      {
        model: "claude-sonnet-5",
        thinking: "adaptive",
        effort: "xhigh",
      },
    );

    assert.ok(
      sonnet.providerSessionId,
      "Sonnet turn did not return a provider session id.",
    );
    assert.equal(
      finalText(sonnet),
      "LEILEIOS_SONNET5_XHIGH",
    );

    const sonnetReadback = requireApplied(
      sonnet,
      "claude-sonnet-5",
      "xhigh",
      "Sonnet 5",
    );
    const sonnetInfo = matchingModelInfo(
      sonnetReadback,
      "claude-sonnet-5",
    );

    if (sonnetInfo) {
      assert.equal(
        sonnetInfo.supports_effort,
        true,
        "Sonnet 5 capability readback did not report effort support.",
      );
      assert.ok(
        sonnetInfo.supported_effort_levels.includes("xhigh"),
        "Sonnet 5 capability readback did not include xhigh.",
      );
      assert.equal(
        sonnetInfo.supports_adaptive_thinking,
        true,
        "Sonnet 5 capability readback did not report adaptive thinking.",
      );
    }

    const sessionId = sonnet.providerSessionId;

    const opus = await transport.resume(
      sessionId,
      [
        "Stay in this same provider session.",
        "Reply with exactly LEILEIOS_OPUS55_MEDIUM and nothing else.",
        "Do not use tools.",
      ].join("\n"),
      {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "medium",
      },
    );

    assert.equal(
      opus.providerSessionId,
      sessionId,
      "Per-turn model switch changed provider session identity.",
    );
    assert.equal(
      finalText(opus),
      "LEILEIOS_OPUS55_MEDIUM",
    );

    const opusReadback = requireApplied(
      opus,
      "claude-opus-5-5",
      "medium",
      "Opus 5.5",
    );
    const opusInfo = matchingModelInfo(
      opusReadback,
      "claude-opus-5-5",
    );

    if (opusInfo) {
      assert.equal(
        opusInfo.supports_effort,
        true,
        "Opus 5.5 capability readback did not report effort support.",
      );
      assert.ok(
        opusInfo.supported_effort_levels.includes("medium"),
        "Opus 5.5 capability readback did not include medium.",
      );
      assert.equal(
        opusInfo.supports_adaptive_thinking,
        true,
        "Opus 5.5 capability readback did not report adaptive thinking.",
      );
    }

    assert.notEqual(
      sonnetReadback.applied.model,
      opusReadback.applied.model,
      "Applied model did not actually change between turns.",
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          providerSessionId: sessionId,
          turns: {
            sonnet5: {
              requested: sonnetReadback.requested,
              applied: sonnetReadback.applied,
              capability: sonnetInfo,
              finalText: finalText(sonnet),
            },
            opus55: {
              requested: opusReadback.requested,
              applied: opusReadback.applied,
              capability: opusInfo,
              finalText: finalText(opus),
            },
          },
          supportedModelsDiscovery: {
            sonnetTurnCount:
              sonnetReadback.supported_models.length,
            opusTurnCount:
              opusReadback.supported_models.length,
            sonnetExactOrDisplayMatch:
              Boolean(sonnetInfo),
            opusExactOrDisplayMatch:
              Boolean(opusInfo),
            values:
              opusReadback.supported_models.map(
                (model) => model.value,
              ),
          },
          identity: {
            sameProviderSessionAcrossModelSwitch:
              opus.providerSessionId === sessionId,
          },
          note:
            "supportedModels() is capability evidence only; LeileiOS product allowlist remains authoritative because discovery can omit aliases.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
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
