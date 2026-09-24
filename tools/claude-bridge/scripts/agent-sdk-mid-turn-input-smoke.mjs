import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createAgentSdkTurnHandle,
} from "../src/agent-sdk-turn-handle.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

const UPDATED =
  "LEILEIOS_MIDTURN_UPDATED";

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(
  filePath,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 50),
    );
  }
  return false;
}

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "result",
    );
  return typeof event?.payload?.final_text
    === "string"
    ? event.payload.final_text.trim()
    : null;
}

async function run() {
  const cwd = await mkdtemp(
    path.join(
      tmpdir(),
      "leileios-agent-sdk-mid-turn-",
    ),
  );
  const startedMarker = path.join(
    cwd,
    "started.txt",
  );
  const finishedMarker = path.join(
    cwd,
    "finished.txt",
  );

  let stage = "create_handle";
  let handle = null;
  let forceExitTimer = null;
  let injectionTask = null;
  let injectionReceipt = null;
  let sawBashToolUse = false;
  let injectedWhileToolRunning = false;

  const setStage = (next) => {
    stage = next;
    process.stderr.write(
      `[mid-turn-smoke] stage=${next}\n`,
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
            "Agent SDK mid-turn input smoke exceeded 75 seconds. The active turn was hard-aborted.",
        },
        null,
        2,
      ) + "\n",
    );
    forceExitTimer = setTimeout(() => {
      process.exit(1);
    }, 5_000);
  }, 75_000);

  try {
    const command = [
      `printf 'STARTED' > ${JSON.stringify(startedMarker)}`,
      "sleep 5",
      `printf 'FINISHED' > ${JSON.stringify(finishedMarker)}`,
    ].join("; ");

    setStage("create_handle");
    handle = await createAgentSdkTurnHandle({
      prompt: [
        "This is a deterministic LeileiOS mid-turn input smoke.",
        "Use the Bash tool exactly once.",
        "Run exactly this command:",
        command,
        "The command intentionally runs for several seconds.",
        "After the Bash tool completes, read any additional user message that arrived while the tool was running before composing your final answer.",
        "If no later user message arrives, reply exactly LEILEIOS_MIDTURN_INITIAL.",
      ].join("\n"),
      cwd,
      environment: process.env,
      midTurnInput: true,
      streaming: true,
      queryOptions: {
        model: "claude-sonnet-5",
        effort: "low",
        settingSources: [],
        tools: ["Bash"],
        allowedTools: ["Bash"],
        verbatimPrompts: true,
      },
    });

    handle.events.on(
      "normalized-event",
      (event) => {
        if (
          event.type !== "tool_use"
          || event.payload?.tool_name
            !== "Bash"
          || injectionTask
        ) {
          return;
        }

        sawBashToolUse = true;
        injectionTask = (async () => {
          setStage("wait_started_marker");
          const started = await waitForFile(
            startedMarker,
          );
          assert.equal(
            started,
            true,
            "Bash tool_use was observed but STARTED marker never appeared.",
          );
          assert.equal(
            await fileExists(
              finishedMarker,
            ),
            false,
            "Bash finished before the mid-turn message was injected.",
          );

          setStage("inject_mid_turn");
          injectionReceipt =
            handle.sendUserMessage(
              [
                "This is the later user message.",
                "Replace the previous final-answer instruction.",
                `After Bash completes, reply with exactly ${UPDATED} and nothing else.`,
              ].join("\n"),
            );
          injectedWhileToolRunning = true;
        })();
      },
    );

    setStage("start");
    const result = await handle.start();

    if (injectionTask) {
      await injectionTask;
    }

    setStage("assert");
    assert.equal(
      sawBashToolUse,
      true,
      "Real SDK never emitted the expected Bash tool_use.",
    );
    assert.equal(
      injectedWhileToolRunning,
      true,
      "Mid-turn user message was not injected while Bash was still running.",
    );
    assert.deepEqual(
      injectionReceipt,
      { status: "queued" },
    );
    assert.equal(
      await fileExists(startedMarker),
      true,
    );
    assert.equal(
      await fileExists(finishedMarker),
      true,
      "Bash did not finish after mid-turn input was queued.",
    );
    assert.equal(
      finalText(result),
      UPDATED,
      "The final answer did not follow the user message injected while the tool was running.",
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
            "dedicated_agent_sdk_mid_turn_input",
          providerSessionId:
            result.providerSessionId,
          sawBashToolUse,
          startedMarkerCreated:
            await fileExists(
              startedMarker,
            ),
          finishedMarkerCreated:
            await fileExists(
              finishedMarker,
            ),
          injectedWhileToolRunning,
          injectionReceipt,
          finalText:
            finalText(result),
          expectedFinalText: UPDATED,
          sameTurnSteering:
            finalText(result) === UPDATED,
          note:
            "The second user message was queued after Bash had started and before it finished; the terminal answer followed the later instruction without interrupting or restarting the provider session.",
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
    await rm(cwd, {
      recursive: true,
      force: true,
    });
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
