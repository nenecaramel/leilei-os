import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeEventNormalizer,
} from "../src/normalized-events.mjs";
import {
  evaluateTurnBoundaryCompaction,
  normalizeAgentSdkContextUsage,
} from "../src/agent-sdk-context-observability.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

function terminalText(events) {
  const result = [...events]
    .reverse()
    .find((message) => message?.type === "result");
  return typeof result?.result === "string" ? result.result.trim() : "";
}

async function runTurn({
  cwd,
  prompt,
  resume = null,
  verbatimPrompts = true,
  hooks = undefined,
  sampleContextUsage = false,
  mode = resume ? "resume" : "new",
}) {
  const runtime = query({
    prompt,
    options: {
      cwd,
      env: process.env,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      verbatimPrompts,
      maxTurns: 1,
      ...(resume ? { resume } : {}),
      ...(hooks ? { hooks } : {}),
    },
  });

  const events = [];
  const normalizedEvents = [];
  let providerSessionId = null;
  let contextUsage = null;
  let contextUsageError = null;
  const normalizer = new ClaudeEventNormalizer({
    logicalConversationId: "compaction-smoke",
    mode,
    parentProviderSessionId: resume,
  });

  for await (const message of runtime) {
    events.push(message);
    providerSessionId =
      providerSessionId
      ?? (typeof message?.session_id === "string"
        ? message.session_id
        : null);

    normalizedEvents.push(...normalizer.normalize(message));

    if (
      sampleContextUsage
      && !contextUsage
      && message?.type === "assistant"
      && typeof runtime.getContextUsage === "function"
    ) {
      try {
        contextUsage = await runtime.getContextUsage({
          detail: "summary",
        });
      } catch (error) {
        contextUsageError =
          error instanceof Error ? error.message : String(error);
      }
    }
  }

  const result = [...events]
    .reverse()
    .find((message) => message?.type === "result");

  assert.ok(result, "Agent SDK turn did not emit a terminal result.");
  assert.equal(
    result.is_error,
    false,
    `Agent SDK turn failed: ${result?.subtype ?? "unknown"}`,
  );

  return {
    providerSessionId,
    events,
    normalizedEvents,
    contextUsage,
    contextUsageError,
    finalText: terminalText(events),
  };
}

async function run() {
  const cwd = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-compact-"),
  );
  const durableMarker =
    `LEILEIOS_COMPACT_MEMORY_${randomUUID()
      .replaceAll("-", "")
      .slice(0, 16)}`;

  try {
    let sessionId = null;
    let beforeUsage = null;

    for (let index = 1; index <= 5; index += 1) {
      const payload = Array.from(
        { length: 350 },
        (_, item) => `seed-${index}-${item}`,
      ).join(" ");

      const turn = await runTurn({
        cwd,
        resume: sessionId,
        sampleContextUsage: index === 5,
        prompt: [
          `Compaction smoke seed turn ${index} of 5.`,
          `The durable marker is ${durableMarker}.`,
          "Remember that exact durable marker across future compaction.",
          "Do not use tools.",
          `Payload: ${payload}`,
          `Reply with exactly LEILEIOS_COMPACT_SEED_${index} and nothing else.`,
        ].join("\n"),
      });

      assert.equal(
        turn.finalText,
        `LEILEIOS_COMPACT_SEED_${index}`,
        `seed turn ${index} returned unexpected final text`,
      );

      if (sessionId) {
        assert.equal(
          turn.providerSessionId,
          sessionId,
          "seed resume changed provider session identity.",
        );
      } else {
        assert.ok(
          turn.providerSessionId,
          "first seed turn did not return a provider session id.",
        );
        sessionId = turn.providerSessionId;
      }

      if (index === 5) {
        beforeUsage = turn.contextUsage;
        assert.ok(
          beforeUsage,
          `pre-compact getContextUsage() failed: ${turn.contextUsageError ?? "unknown error"}`,
        );
      }
    }

    const preCompactHooks = [];
    const postCompactHooks = [];
    const hooks = {
      PreCompact: [
        {
          hooks: [
            async (input) => {
              preCompactHooks.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                customInstructions:
                  typeof input?.custom_instructions === "string"
                    ? input.custom_instructions
                    : null,
              });
              return {};
            },
          ],
        },
      ],
      PostCompact: [
        {
          hooks: [
            async (input) => {
              postCompactHooks.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                summary:
                  typeof input?.compact_summary === "string"
                    ? input.compact_summary
                    : null,
              });
              return {};
            },
          ],
        },
      ],
    };

    // Internal slash-command execution intentionally disables verbatimPrompts.
    // Normal LeileiOS user turns may remain verbatim without losing the ability
    // for Runtime-owned compaction to dispatch /compact deterministically.
    const compactTurn = await runTurn({
      cwd,
      prompt: "/compact",
      resume: sessionId,
      verbatimPrompts: false,
      hooks,
      mode: "resume",
    });

    assert.equal(
      compactTurn.providerSessionId,
      sessionId,
      "manual compact changed provider session identity.",
    );

    const rawBoundaries = compactTurn.events.filter(
      (message) =>
        message?.type === "system"
        && message?.subtype === "compact_boundary",
    );
    const normalizedCompactions = compactTurn.normalizedEvents.filter(
      (event) => event.type === "compaction",
    );

    assert.equal(
      rawBoundaries.length,
      1,
      `manual /compact emitted ${rawBoundaries.length} compact boundaries; result text: ${compactTurn.finalText || "<empty>"}`,
    );
    assert.equal(
      normalizedCompactions.length,
      1,
      "LeileiOS normalizer did not preserve the compact boundary.",
    );
    assert.equal(
      normalizedCompactions[0].payload.trigger,
      "manual",
      "normalized compact trigger was not manual.",
    );
    assert.ok(
      Number.isFinite(normalizedCompactions[0].payload.pre_tokens)
        && normalizedCompactions[0].payload.pre_tokens > 0,
      "compact boundary did not report positive pre_tokens.",
    );

    assert.equal(
      preCompactHooks.length,
      1,
      "PreCompact hook did not fire exactly once.",
    );
    assert.equal(
      preCompactHooks[0].trigger,
      "manual",
      "PreCompact hook trigger was not manual.",
    );
    assert.equal(
      postCompactHooks.length,
      1,
      "PostCompact hook did not fire exactly once.",
    );
    assert.equal(
      postCompactHooks[0].trigger,
      "manual",
      "PostCompact hook trigger was not manual.",
    );
    assert.ok(
      postCompactHooks[0].summary?.trim(),
      "PostCompact hook did not expose the generated compact summary.",
    );

    const afterTurn = await runTurn({
      cwd,
      resume: sessionId,
      sampleContextUsage: true,
      prompt: [
        "The conversation was just manually compacted.",
        "Reply with exactly the durable marker I explicitly asked you to remember before compaction.",
        "Do not add punctuation or any other text. Do not use tools.",
      ].join("\n"),
    });

    assert.equal(
      afterTurn.providerSessionId,
      sessionId,
      "post-compact resume changed provider session identity.",
    );
    assert.equal(
      afterTurn.finalText,
      durableMarker,
      "post-compact session continuity did not preserve the durable marker.",
    );
    assert.ok(
      afterTurn.contextUsage,
      `post-compact getContextUsage() failed: ${afterTurn.contextUsageError ?? "unknown error"}`,
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          providerSessionId: sessionId,
          durableMarker,
          contextUsage: {
            beforeCompact:
              normalizeAgentSdkContextUsage(beforeUsage),
            afterCompact:
              normalizeAgentSdkContextUsage(afterTurn.contextUsage),
          },
          deterministicPolicy: {
            beforeCompact:
              evaluateTurnBoundaryCompaction(beforeUsage),
            afterCompact:
              evaluateTurnBoundaryCompaction(afterTurn.contextUsage),
            note:
              "advisory only; this smoke invokes manual /compact directly and does not enable automatic compaction",
          },
          compactBoundary: normalizedCompactions[0].payload,
          hooks: {
            preCompact: preCompactHooks,
            postCompact: postCompactHooks.map((hook) => ({
              hookEventName: hook.hookEventName,
              trigger: hook.trigger,
              summaryLength: hook.summary?.length ?? 0,
              summaryContainsDurableMarker:
                hook.summary?.includes(durableMarker) ?? false,
            })),
          },
          continuity: {
            postCompactFinalText: afterTurn.finalText,
            preservedDurableMarker:
              afterTurn.finalText === durableMarker,
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
