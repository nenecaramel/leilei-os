import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { query } from "@anthropic-ai/claude-agent-sdk";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

function userMessage(text) {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function finalText(result) {
  return typeof result?.result === "string"
    ? result.result.trim()
    : null;
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

async function run() {
  const cwd = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-interrupt-"),
  );
  const startedMarkerPath = path.join(cwd, "interrupt-started.txt");
  const markerPath = path.join(cwd, "interrupt-finished.txt");
  const inputGate = deferred();

  let runtime = null;
  let providerSessionId = null;
  let sawBashToolUse = false;
  let interruptStarted = false;
  let interruptReceipt = null;
  let interruptError = null;
  let interruptPromise = null;
  let iterationError = null;
  let terminalResult = null;
  let rawEventCount = 0;

  async function* promptStream() {
    yield userMessage([
      "This is a deterministic LeileiOS graceful-interrupt smoke.",
      "Use the Bash tool exactly once.",
      "Run exactly this command and wait for it to finish:",
      `printf 'LEILEIOS_INTERRUPT_STARTED' > ${JSON.stringify(startedMarkerPath)} && sleep 30 && printf 'LEILEIOS_INTERRUPT_FINISHED' > ${JSON.stringify(markerPath)}`,
      "Do not use any other tool.",
      "Do not reply before the Bash command finishes.",
    ].join("\n"));
    await inputGate.promise;
  }

  try {
    runtime = query({
      prompt: promptStream(),
      options: {
        cwd,
        env: process.env,
        settingSources: ["user", "project", "local"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
        },
        allowedTools: ["Bash"],
      },
    });

    assert.equal(
      typeof runtime?.interrupt,
      "function",
      "Real SDK Query does not expose interrupt().",
    );

    const noToolWatchdog = setTimeout(() => {
      if (!interruptStarted) {
        inputGate.resolve();
        runtime?.close?.();
      }
    }, 20_000);

    const hardStopWatchdog = setTimeout(() => {
      inputGate.resolve();
      runtime?.close?.();
    }, 45_000);

    try {
      for await (const message of runtime) {
        rawEventCount += 1;

        if (
          !providerSessionId
          && message?.type === "system"
          && message?.subtype === "init"
          && typeof message.session_id === "string"
        ) {
          providerSessionId = message.session_id;
        }

        for (const block of message?.message?.content ?? []) {
          if (
            !interruptStarted
            && block?.type === "tool_use"
            && block?.name === "Bash"
          ) {
            sawBashToolUse = true;
            interruptStarted = true;
            interruptPromise = (async () => {
              const started = await waitForFile(
                startedMarkerPath,
              );
              if (!started) {
                throw new Error(
                  "Bash tool_use was emitted but the STARTED marker never appeared.",
                );
              }
              return runtime.interrupt();
            })()
              .then((receipt) => {
                interruptReceipt = receipt ?? null;
                inputGate.resolve();
                return receipt;
              })
              .catch((error) => {
                interruptError =
                  error instanceof Error
                    ? error.message
                    : String(error);
                inputGate.resolve();
                throw error;
              });
          }
        }

        if (message?.type === "result") {
          terminalResult = message;
        }
      }
    } catch (error) {
      iterationError =
        error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(noToolWatchdog);
      clearTimeout(hardStopWatchdog);
      inputGate.resolve();
    }

    if (interruptPromise) {
      try {
        await interruptPromise;
      } catch {
        // interruptError already captures the control-path failure.
      }
    }

    assert.equal(
      sawBashToolUse,
      true,
      "No real Bash tool_use was observed before the interrupt watchdog.",
    );
    assert.equal(
      interruptError,
      null,
      `Query.interrupt() failed: ${interruptError}`,
    );
    assert.ok(
      interruptReceipt && typeof interruptReceipt === "object",
      "Query.interrupt() did not return the typed interrupt receipt expected from SDK 0.3.281.",
    );
    assert.ok(
      providerSessionId,
      "Interrupted Query did not expose a provider session id.",
    );

    const startedMarkerCreated =
      await fileExists(startedMarkerPath);
    assert.equal(
      startedMarkerCreated,
      true,
      "The Bash STARTED marker was never created before Query.interrupt().",
    );

    const markerCreated = await fileExists(markerPath);
    assert.equal(
      markerCreated,
      false,
      "The 30-second Bash FINISHED marker was created despite Query.interrupt().",
    );

    const continuityMarker =
      "LEILEIOS_INTERRUPT_SESSION_CONTINUITY";
    const resumed = query({
      prompt:
        `Reply with exactly ${continuityMarker} and nothing else. Do not use tools.`,
      options: {
        cwd,
        env: process.env,
        settingSources: ["user", "project", "local"],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
        },
        verbatimPrompts: true,
        resume: providerSessionId,
      },
    });

    let resumedSessionId = null;
    let resumedResult = null;
    let resumedEventCount = 0;
    for await (const message of resumed) {
      resumedEventCount += 1;
      if (
        !resumedSessionId
        && message?.type === "system"
        && message?.subtype === "init"
        && typeof message.session_id === "string"
      ) {
        resumedSessionId = message.session_id;
      }
      if (message?.type === "result") {
        resumedResult = message;
      }
    }

    assert.ok(
      resumedResult,
      "Interrupted provider session could not be resumed to a terminal result.",
    );
    assert.equal(
      resumedResult.is_error,
      false,
      "Post-interrupt resume ended in an error result.",
    );
    assert.equal(
      finalText(resumedResult),
      continuityMarker,
      "Post-interrupt resume did not preserve provider-session continuity.",
    );
    assert.equal(
      resumedSessionId,
      providerSessionId,
      "Post-interrupt resume changed provider session identity.",
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          interrupt: {
            providerSessionId,
            sawBashToolUse,
            receipt: interruptReceipt,
            startedMarkerCreated,
            markerCreated,
            rawEventCount,
            terminal: terminalResult
              ? {
                  subtype: terminalResult.subtype ?? null,
                  isError:
                    typeof terminalResult.is_error === "boolean"
                      ? terminalResult.is_error
                      : null,
                  errors: Array.isArray(terminalResult.errors)
                    ? terminalResult.errors
                    : [],
                }
              : null,
            iterationError,
          },
          continuity: {
            resumedSessionId,
            sameProviderSession:
              resumedSessionId === providerSessionId,
            finalText: finalText(resumedResult),
            rawEventCount: resumedEventCount,
          },
          note:
            "This is raw SDK capability evidence only. It proves Query.interrupt() receipt, in-flight tool interruption, and same-session continuation; it does not yet change the LeileiOS daemon/runtime protocol.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    inputGate.resolve();
    runtime?.close?.();
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
      },
      null,
      2,
    ) + "\n",
  );
  process.exitCode = 1;
});
