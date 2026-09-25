import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  AgentSdkClaudeTransport,
} from "../tools/claude-bridge/src/agent-sdk-claude-transport.mjs";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/native-live-mac-runtime-executor.js";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this acceptance verifies existing Claude subscription auth.",
  );
}

const execution = {
  model: "claude-sonnet-5",
  thinking: "adaptive",
  effort: "low",
};

const thresholdPercent = 75;
const initialFillerWords = Number(
  process.env.AUTO_COMPACT_INITIAL_FILLER_WORDS ?? "720000",
);
const topUpFillerWords = Number(
  process.env.AUTO_COMPACT_TOP_UP_FILLER_WORDS ?? "60000",
);
const maxTopUps = Number(
  process.env.AUTO_COMPACT_MAX_TOP_UPS ?? "3",
);

for (const [label, value] of [
  ["AUTO_COMPACT_INITIAL_FILLER_WORDS", initialFillerWords],
  ["AUTO_COMPACT_TOP_UP_FILLER_WORDS", topUpFillerWords],
  ["AUTO_COMPACT_MAX_TOP_UPS", maxTopUps],
]) {
  assert.ok(
    Number.isInteger(value) && value > 0,
    `${label} must be a positive integer.`,
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

function largeFiller(words) {
  return "x ".repeat(words);
}

async function run() {
  const marker =
    `LEILEIOS_AUTO_COMPACT_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 16)}`;

  const transport = new AgentSdkClaudeTransport({
    cwd: process.cwd(),
    environment: process.env,
    compactionThresholdPercent: thresholdPercent,
  });

  process.stdout.write(
    JSON.stringify({
      phase: "seeding",
      sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
      auth: "existing_claude_subscription_login",
      thresholdPercent,
      initialFillerWords,
      topUpFillerWords,
      maxTopUps,
    }) + "\n",
  );

  const first = await transport.sendNew(
    [
      `Remember this exact durable marker across any later compaction: ${marker}`,
      "Do not use tools.",
      "The filler below exists only to create a genuinely large live provider context.",
      largeFiller(initialFillerWords),
      "Reply with exactly HOT_CONTEXT_SEED_0 and nothing else.",
    ].join("\n"),
    execution,
  );

  assert.ok(first.providerSessionId);
  assert.equal(finalText(first), "HOT_CONTEXT_SEED_0");
  assert.ok(
    first.contextUsage,
    `Initial live context usage unavailable: ${first.contextUsageError ?? "unknown"}`,
  );

  let hot = first;
  let hotSessionId = first.providerSessionId;
  let topUps = 0;

  while (
    (hot.contextUsage?.percentage ?? 0) < thresholdPercent
    && topUps < maxTopUps
  ) {
    topUps += 1;
    hot = await transport.resume(
      hotSessionId,
      [
        "Keep remembering the durable marker from the first turn.",
        "Do not use tools.",
        largeFiller(topUpFillerWords),
        `Reply with exactly HOT_CONTEXT_SEED_${topUps} and nothing else.`,
      ].join("\n"),
      execution,
    );
    assert.equal(hot.providerSessionId, hotSessionId);
    assert.equal(
      finalText(hot),
      `HOT_CONTEXT_SEED_${topUps}`,
    );
    assert.ok(
      hot.contextUsage,
      `Top-up ${topUps} live context usage unavailable: ${hot.contextUsageError ?? "unknown"}`,
    );
  }

  const hotPercent = hot.contextUsage?.percentage ?? null;
  assert.ok(
    hotPercent !== null && hotPercent >= thresholdPercent,
    `Real provider context did not reach ${thresholdPercent}% after ${topUps} top-ups; observed ${hotPercent}.`,
  );
  assert.equal(hot.compactionAdvisory?.due, true);
  assert.equal(
    hot.compactionAdvisory?.reason,
    "turn_boundary_threshold_reached",
  );

  process.stdout.write(
    JSON.stringify({
      phase: "hot_context",
      providerSessionId: hotSessionId,
      topUps,
      contextUsage: hot.contextUsage,
      advisory: hot.compactionAdvisory,
    }) + "\n",
  );

  const executor = new NativeLiveMacRuntimeExecutor(transport);
  const conversationId = randomUUID();
  const result = await executor.execute({
    protocol_version: 1,
    dispatch_target: "claude_code",
    prepare_id: randomUUID(),
    request_id: randomUUID(),
    operation: "send",
    conversation_id: conversationId,
    canonical_user_message_id: randomUUID(),
    runtime_mode: "fork",
    parent_provider_session_id: hotSessionId,
    execution_selection: execution,
    prompt: [
      "This is the real >75% automatic compaction trigger turn.",
      "Keep the durable marker from the parent provider session.",
      "Do not use tools.",
      "Reply with exactly AUTO_COMPACT_TRIGGER_OK and nothing else.",
    ].join("\n"),
  });

  assert.equal(result.status, "success");
  if (result.status !== "success") {
    throw new Error(`Runtime trigger failed: ${result.error_code}`);
  }
  assert.notEqual(
    result.provider_session_id,
    hotSessionId,
    "Forked trigger turn did not produce a child provider session.",
  );

  const metadata = result.runtime_metadata;
  assert.ok(metadata, "Trigger turn returned no runtime metadata.");
  const contextUsage = metadata.context_usage;
  const advisory = metadata.compaction_advisory;
  const compaction = metadata.compaction;
  assert.ok(contextUsage);
  assert.ok(
    (contextUsage.percentage ?? 0) >= thresholdPercent,
    `Trigger turn was not genuinely over threshold: ${contextUsage.percentage}.`,
  );
  assert.equal(advisory?.due, true);
  assert.equal(
    advisory?.reason,
    "turn_boundary_threshold_reached",
  );
  assert.ok(compaction);
  assert.equal(compaction.source, "runtime_threshold");
  assert.equal(compaction.attempted, true);
  assert.equal(compaction.outcome, "succeeded");
  assert.equal(compaction.failure_code, null);
  const boundary = compaction.boundary;
  assert.ok(boundary);
  assert.ok(
    Number(boundary.pre_tokens) > 0,
    "Auto-compact boundary did not expose positive pre_tokens.",
  );
  assert.ok(
    Number(boundary.post_tokens) > 0,
    "Auto-compact boundary did not expose positive post_tokens.",
  );
  assert.ok(
    Number(boundary.post_tokens)
      < Number(boundary.pre_tokens),
    "Auto-compact did not reduce provider context tokens.",
  );
  const summary = compaction.summary;
  assert.ok(
    summary?.trim(),
    "Auto-compact did not expose a summary.",
  );
  assert.ok(
    summary.includes(marker),
    "Auto-compact summary did not preserve the durable marker.",
  );
  assert.equal(
    finalText({ normalizedEvents: result.normalized_events }),
    "AUTO_COMPACT_TRIGGER_OK",
  );

  const compactedSessionId = result.provider_session_id;
  const after = await transport.resume(
    compactedSessionId,
    [
      "The parent conversation was automatically compacted by LeileiOS.",
      "Reply with exactly the durable marker from before compaction.",
      "Do not add punctuation or any other text. Do not use tools.",
    ].join("\n"),
    execution,
  );

  assert.equal(
    after.providerSessionId,
    compactedSessionId,
    "Post-compact resume changed provider session identity.",
  );
  assert.equal(
    finalText(after),
    marker,
    "Post-auto-compact continuity lost the durable marker.",
  );
  assert.ok(
    after.contextUsage,
    `Post-compact context usage unavailable: ${after.contextUsageError ?? "unknown"}`,
  );
  assert.ok(
    (after.contextUsage.percentage ?? 100)
      < (contextUsage.percentage ?? 0),
    "Post-compact context usage did not decrease.",
  );

  process.stdout.write(
    JSON.stringify({
      phase: "accepted",
      thresholdPercent,
      preCompactObservedPercent:
        contextUsage.percentage,
      advisory,
      compaction,
      childProviderSessionId: compactedSessionId,
      parentProviderSessionId: hotSessionId,
      postCompactContextUsage: after.contextUsage,
      continuity: {
        marker,
        finalText: finalText(after),
        preserved: finalText(after) === marker,
      },
    }) + "\n",
  );
}

run().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      phase: "failed",
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      runtimeCode:
        error && typeof error === "object" && "runtimeCode" in error
          ? error.runtimeCode
          : null,
    }) + "\n",
  );
  process.exitCode = 1;
});
