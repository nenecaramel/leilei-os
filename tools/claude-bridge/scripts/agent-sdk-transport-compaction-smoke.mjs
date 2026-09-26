import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

async function run() {
  const cwd = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-transport-compact-"),
  );
  const marker =
    `LEILEIOS_TRANSPORT_COMPACT_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 16)}`;

  try {
    const transport = new AgentSdkClaudeTransport({
      cwd,
      environment: process.env,
      compactionThresholdPercent: 75,
    });

    const first = await transport.sendNew(
      [
        `Remember this exact durable marker: ${marker}`,
        "Do not use tools.",
        "Reply with exactly LEILEIOS_TRANSPORT_SEED_1 and nothing else.",
      ].join("\n"),
    );

    assert.ok(
      first.providerSessionId,
      "transport sendNew did not return a provider session id.",
    );
    assert.equal(
      finalText(first),
      "LEILEIOS_TRANSPORT_SEED_1",
    );
    assert.ok(
      first.contextUsage,
      `transport did not capture live context usage: ${first.contextUsageError ?? "unknown error"}`,
    );
    assert.equal(
      typeof first.compactionAdvisory?.due,
      "boolean",
      "transport did not return a compaction advisory.",
    );

    const sessionId = first.providerSessionId;

    const second = await transport.resume(
      sessionId,
      [
        `The durable marker is still ${marker}.`,
        "Do not use tools.",
        "Reply with exactly LEILEIOS_TRANSPORT_SEED_2 and nothing else.",
      ].join("\n"),
    );

    assert.equal(
      second.providerSessionId,
      sessionId,
      "transport resume changed provider session identity.",
    );
    assert.equal(
      finalText(second),
      "LEILEIOS_TRANSPORT_SEED_2",
    );
    assert.ok(
      second.contextUsage,
      `resume did not capture live context usage: ${second.contextUsageError ?? "unknown error"}`,
    );

    const compacted = await transport.compact(sessionId);

    assert.equal(
      compacted.providerSessionId,
      sessionId,
      "transport compact changed provider session identity.",
    );
    assert.equal(
      compacted.compaction?.boundary?.trigger,
      "manual",
      "transport compact boundary was not manual.",
    );
    assert.ok(
      Number.isFinite(compacted.compaction?.boundary?.pre_tokens)
        && compacted.compaction.boundary.pre_tokens > 0,
      "transport compact did not report positive pre_tokens.",
    );
    assert.equal(
      compacted.compaction?.preCompact?.length,
      1,
      "transport did not capture one PreCompact hook.",
    );
    assert.equal(
      compacted.compaction?.postCompact?.length,
      1,
      "transport did not capture one PostCompact hook.",
    );
    assert.ok(
      compacted.compaction.postCompact[0]?.summary?.trim(),
      "transport did not capture the compact summary.",
    );
    assert.ok(
      compacted.compaction.postCompact[0].summary.includes(marker),
      "transport compact summary did not preserve the durable marker.",
    );

    const after = await transport.resume(
      sessionId,
      [
        "The conversation was just compacted.",
        "Reply with exactly the durable marker I asked you to remember.",
        "Do not add punctuation or any other text. Do not use tools.",
      ].join("\n"),
    );

    assert.equal(
      after.providerSessionId,
      sessionId,
      "post-compact transport resume changed provider session identity.",
    );
    assert.equal(
      finalText(after),
      marker,
      "post-compact transport continuity lost the durable marker.",
    );
    assert.ok(
      after.contextUsage,
      `post-compact resume did not capture context usage: ${after.contextUsageError ?? "unknown error"}`,
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          providerSessionId: sessionId,
          marker,
          contextUsage: {
            beforeCompact: second.contextUsage,
            afterCompact: after.contextUsage,
          },
          advisory: {
            beforeCompact: second.compactionAdvisory,
            afterCompact: after.compactionAdvisory,
          },
          compaction: {
            boundary: compacted.compaction.boundary,
            preCompactCount: compacted.compaction.preCompact.length,
            postCompactCount: compacted.compaction.postCompact.length,
            summaryLength:
              compacted.compaction.postCompact[0].summary.length,
            summaryContainsMarker:
              compacted.compaction.postCompact[0].summary.includes(marker),
          },
          continuity: {
            finalText: finalText(after),
            preservedMarker: finalText(after) === marker,
          },
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
