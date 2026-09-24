import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  startAgentSdkTurn,
} from "../src/agent-sdk-turn-handle.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fileExists(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return fileExists(filePath);
}

function finalText(result) {
  const event = [...result.normalizedEvents]
    .reverse()
    .find((candidate) => candidate.type === "result");
  return typeof event?.payload?.final_text === "string"
    ? event.payload.final_text.trim()
    : null;
}

async function run() {
  const cwd = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-turn-handle-"),
  );
  const startedMarker =
    path.join(cwd, "interrupt-started.txt");
  const finishedMarker =
    path.join(cwd, "interrupt-finished.txt");

  let stage = "start";
  let activeHandle = null;
  let forceExitTimer = null;

  const totalWatchdog = setTimeout(() => {
    const failedStage = stage;
    activeHandle?.abort();
    process.stderr.write(
      JSON.stringify(
        {
          outcome: "FAIL",
          reason: "watchdog_timeout",
          stage: failedStage,
          message:
            "Agent SDK turn-handle smoke exceeded 60 seconds. The active turn was hard-aborted; the process will force-exit if SDK cleanup does not return.",
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
    stage = "start_interrupted_turn";
    const prompt = [
      "This is a deterministic LeileiOS turn-handle interrupt smoke.",
      "Use the Bash tool exactly once.",
      "Run exactly this command and wait for it to finish:",
      `printf 'LEILEIOS_TURN_HANDLE_STARTED' > ${JSON.stringify(startedMarker)} && sleep 30 && printf 'LEILEIOS_TURN_HANDLE_FINISHED' > ${JSON.stringify(finishedMarker)}`,
      "Do not use any other tool.",
      "Do not reply before the Bash command finishes.",
    ].join("\n");

    const handle = await startAgentSdkTurn({
      prompt,
      cwd,
      environment: process.env,
    });
    activeHandle = handle;

    let sawBashToolUse = false;
    let interruptPromise = null;

    handle.events.on("normalized-event", (event) => {
      if (
        !interruptPromise
        && event?.type === "tool_use"
        && event?.payload?.tool_name === "Bash"
      ) {
        sawBashToolUse = true;
        interruptPromise = (async () => {
          stage = "wait_started_marker";
          const started = await waitForFile(startedMarker);
          assert.equal(
            started,
            true,
            "Bash tool_use was observed but STARTED marker never appeared.",
          );
          stage = "graceful_interrupt";
          return handle.interrupt();
        })();
        interruptPromise.catch(() => {});
      }
    });

    stage = "await_interrupted_completion";
    let interruptedError = null;
    try {
      await handle.completion;
    } catch (error) {
      interruptedError = error;
    }

    assert.equal(
      sawBashToolUse,
      true,
      "No normalized Bash tool_use was observed.",
    );
    assert.ok(
      interruptPromise,
      "No graceful interrupt was requested.",
    );

    const receipt = await interruptPromise;
    assert.ok(interruptedError);
    assert.equal(
      interruptedError.runtimeCode,
      "INTERRUPTED",
    );
    assert.deepEqual(
      interruptedError.interruptReceipt,
      receipt,
    );
    assert.ok(
      interruptedError.providerSessionId,
      "Interrupted turn lost provider session identity.",
    );

    const startedMarkerCreated =
      await fileExists(startedMarker);
    const finishedMarkerCreated =
      await fileExists(finishedMarker);

    assert.equal(startedMarkerCreated, true);
    assert.equal(finishedMarkerCreated, false);

    stage = "resume_same_session";
    const continuityMarker =
      "LEILEIOS_TURN_HANDLE_CONTINUITY";
    const resumed = await startAgentSdkTurn({
      prompt:
        `Reply with exactly ${continuityMarker} and nothing else. Do not use tools.`,
      mode: "resume",
      parentProviderSessionId:
        interruptedError.providerSessionId,
      resume: interruptedError.providerSessionId,
      cwd,
      environment: process.env,
    });
    activeHandle = resumed;

    const resumedResult = await resumed.completion;
    assert.equal(
      resumedResult.providerSessionId,
      interruptedError.providerSessionId,
    );
    assert.equal(
      finalText(resumedResult),
      continuityMarker,
    );

    stage = "done";
    clearTimeout(totalWatchdog);
    if (forceExitTimer) clearTimeout(forceExitTimer);

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          architecture:
            "dedicated_agent_sdk_turn_handle",
          interrupt: {
            runtimeCode:
              interruptedError.runtimeCode,
            providerSessionId:
              interruptedError.providerSessionId,
            receipt,
            sawBashToolUse,
            startedMarkerCreated,
            finishedMarkerCreated,
            providerTerminal:
              interruptedError.result
                ? {
                    subtype:
                      interruptedError.result.subtype ?? null,
                    isError:
                      typeof interruptedError.result.is_error
                        === "boolean"
                        ? interruptedError.result.is_error
                        : null,
                    errors:
                      Array.isArray(
                        interruptedError.result.errors,
                      )
                        ? interruptedError.result.errors
                        : [],
                  }
                : null,
          },
          continuity: {
            resumedSessionId:
              resumedResult.providerSessionId,
            sameProviderSession:
              resumedResult.providerSessionId
              === interruptedError.providerSessionId,
            finalText: finalText(resumedResult),
          },
          phase1TransportUntouched: true,
          note:
            "This smoke exercises a dedicated long-lived turn handle. The accepted phase-1 AgentSdkClaudeTransport remains unchanged.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    clearTimeout(totalWatchdog);
    if (forceExitTimer) clearTimeout(forceExitTimer);
    activeHandle?.abort();
    await rm(cwd, { recursive: true, force: true });
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
