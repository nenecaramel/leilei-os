import assert from "node:assert/strict";
import process from "node:process";
import {
  createAgentSdkTurnHandle,
} from "../src/agent-sdk-turn-handle.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

const marker =
  "LEILEIOS_STREAM_ALPHA LEILEIOS_STREAM_BETA LEILEIOS_STREAM_GAMMA LEILEIOS_STREAM_DELTA";

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "result",
    );
  return typeof event?.payload?.final_text
    === "string"
    ? event.payload.final_text
    : null;
}

async function run() {
  let stage = "create_handle";
  let handle = null;
  let forceExitTimer = null;

  const setStage = (next) => {
    stage = next;
    process.stderr.write(
      `[streaming-smoke] stage=${next}\n`,
    );
  };

  const watchdog = setTimeout(() => {
    handle?.abort();
    process.stderr.write(
      JSON.stringify(
        {
          outcome: "FAIL",
          reason: "watchdog_timeout",
          stage,
          message:
            "Agent SDK streaming smoke exceeded 60 seconds. The active turn was hard-aborted.",
        },
        null,
        2,
      ) + "\n",
    );
    forceExitTimer = setTimeout(() => {
      process.exit(1);
    }, 5_000);
  }, 60_000);

  try {
    setStage("create_handle");
    handle = await createAgentSdkTurnHandle({
      prompt: [
        "This is a deterministic LeileiOS streaming-output smoke.",
        "Do not use tools.",
        "Reply with exactly the following text and nothing else:",
        marker,
      ].join("\n"),
      environment: process.env,
      streaming: true,
      queryOptions: {
        model: "claude-sonnet-5",
        effort: "low",
        settingSources: [],
        tools: [],
        verbatimPrompts: true,
      },
    });

    const partials = [];
    handle.events.on(
      "normalized-event",
      (event) => {
        if (event.type === "partial_text") {
          partials.push(event);
        }
      },
    );

    setStage("start");
    const result = await handle.start();

    setStage("assert");
    const rawPartialCount =
      result.events.filter(
        (event) =>
          event?.type === "stream_event",
      ).length;
    assert.ok(
      rawPartialCount > 0,
      "Real SDK emitted no stream_event messages.",
    );
    assert.ok(
      partials.length > 0,
      "LeileiOS emitted no normalized partial_text events.",
    );

    const streamedText = partials
      .map(
        (event) => event.payload.delta,
      )
      .join("");
    const terminalText = finalText(result);

    assert.equal(
      streamedText.trim(),
      terminalText?.trim(),
      "Normalized partial_text did not reconstruct the terminal result text.",
    );
    assert.equal(
      terminalText?.trim(),
      marker,
      "Terminal text did not match the deterministic marker.",
    );

    const accumulatedLengths =
      partials.map(
        (event) =>
          event.payload
            .accumulated_length,
      );
    for (
      let i = 1;
      i < accumulatedLengths.length;
      i += 1
    ) {
      assert.ok(
        accumulatedLengths[i]
          > accumulatedLengths[i - 1],
        "partial_text accumulated_length must increase monotonically.",
      );
    }
    assert.equal(
      accumulatedLengths.at(-1),
      streamedText.length,
    );

    setStage("done");
    clearTimeout(watchdog);
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk:
            "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth:
            "existing_claude_subscription_login",
          architecture:
            "dedicated_agent_sdk_streaming_output",
          providerSessionId:
            result.providerSessionId,
          rawStreamEventCount:
            rawPartialCount,
          normalizedPartialTextCount:
            partials.length,
          streamedCharacterCount:
            streamedText.length,
          finalText: terminalText,
          exactReconstruction:
            streamedText.trim()
            === terminalText?.trim(),
          reasoningStreamPolicy:
            "text_deltas_only",
          note:
            "This slice normalizes displayable assistant text deltas only; thinking deltas remain outside the LeileiOS streaming contract.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    clearTimeout(watchdog);
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
    handle?.abort();
  }
}

run().catch((error) => {
  process.stderr.write(
    JSON.stringify(
      {
        outcome: "FAIL",
        name:
          error instanceof Error
            ? error.name
            : "UnknownError",
        message:
          error instanceof Error
            ? error.message
            : String(error),
        runtimeCode:
          error
          && typeof error === "object"
          && "runtimeCode" in error
            ? error.runtimeCode
            : null,
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
