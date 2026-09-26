import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  access,
  mkdtemp,
  rm,
} from "node:fs/promises";
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

function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sessionIdFromError(error) {
  const events =
    error && typeof error === "object" && Array.isArray(error.events)
      ? error.events
      : [];
  const init = events.find(
    (event) => event?.type === "system" && event?.subtype === "init",
  );
  return nonblankString(init?.session_id);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runFailureMappingSmoke(cwd) {
  const transport = new AgentSdkClaudeTransport({
    cwd,
    environment: process.env,
  });

  const missingSessionId = randomUUID();
  let failure = null;

  try {
    await transport.resume(
      missingSessionId,
      "Reply with exactly LEILEIOS_INVALID_RESUME_SHOULD_NOT_SUCCEED.",
    );
  } catch (error) {
    failure = error;
  }

  assert.ok(
    failure,
    "Resuming a deliberately nonexistent provider session unexpectedly succeeded.",
  );
  assert.equal(
    failure.runtimeCode,
    "CLAUDE_PROCESS_FAILED",
    `Invalid real-SDK resume mapped to unexpected runtime code: ${String(failure.runtimeCode)}`,
  );

  return {
    requestedMissingSessionId: missingSessionId,
    runtimeCode: failure.runtimeCode,
    message:
      failure instanceof Error ? failure.message : String(failure),
  };
}

async function runAbortSmoke(cwd) {
  const transport = new AgentSdkClaudeTransport({
    cwd,
    environment: process.env,
  });

  const markerPath = path.join(cwd, "abort-finished.txt");
  let sawBashToolUse = false;
  let abortIssued = false;
  let observedProviderSessionId = null;
  let normalizedEventCount = 0;

  transport.events.on("normalized-event", (event) => {
    normalizedEventCount += 1;

    if (
      !observedProviderSessionId
      && event?.type === "session"
      && nonblankString(event?.payload?.provider_session_id)
    ) {
      observedProviderSessionId =
        nonblankString(event.payload.provider_session_id);
    }

    if (
      !abortIssued
      && event?.type === "tool_use"
      && event?.payload?.tool_name === "Bash"
    ) {
      sawBashToolUse = true;
      abortIssued = true;
      transport.abort();
    }
  });

  const prompt = [
    "This is a deterministic LeileiOS abort smoke.",
    "You MUST use the Bash tool exactly once.",
    "Run exactly this command and wait for it to finish:",
    "sleep 30 && printf 'LEILEIOS_ABORT_FINISHED' > ./abort-finished.txt",
    "Do not use any other tool.",
    "Do not reply before the Bash command finishes.",
  ].join("\n");

  const startedAt = Date.now();
  let failure = null;
  const watchdog = setTimeout(() => {
    if (!abortIssued) {
      abortIssued = true;
      transport.abort();
    }
  }, 20_000);

  try {
    await transport.sendNew(prompt);
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(watchdog);
  }

  const elapsedMs = Date.now() - startedAt;

  assert.ok(
    failure,
    "Real-SDK abort smoke unexpectedly completed successfully.",
  );
  assert.equal(
    failure.runtimeCode,
    "ABORTED",
    `Real-SDK abort mapped to unexpected runtime code: ${String(failure.runtimeCode)}`,
  );
  assert.equal(
    sawBashToolUse,
    true,
    "Abort watchdog fired before a real Bash tool_use was observed; this run does not prove mid-turn abort.",
  );

  const providerSessionId =
    observedProviderSessionId ?? sessionIdFromError(failure);
  assert.ok(
    providerSessionId,
    "Abort smoke did not expose the provider session id before cancellation.",
  );

  const markerCreated = await fileExists(markerPath);
  assert.equal(
    markerCreated,
    false,
    "The 30-second Bash command completed despite abort; hard stop did not interrupt the active turn.",
  );

  return {
    runtimeCode: failure.runtimeCode,
    providerSessionId,
    sawBashToolUse,
    markerCreated,
    elapsedMs,
    normalizedEventCount,
    message:
      failure instanceof Error ? failure.message : String(failure),
  };
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-abort-failure-"),
  );

  try {
    const failureMapping = await runFailureMappingSmoke(root);
    const abort = await runAbortSmoke(root);

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          failureMapping,
          abort,
          note:
            "Invalid provider-session resume proves real SDK failure -> CLAUDE_PROCESS_FAILED mapping; a real Bash turn proves active Query close() -> ABORTED and prevents the long-running command from completing.",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
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
