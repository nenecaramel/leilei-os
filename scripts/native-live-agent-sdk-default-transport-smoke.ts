import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createNativeLiveMacClaudeTransport,
  resolveNativeLiveMacClaudeTransportKind,
} from "../src/domains/bridge/native-live-mac-claude-transport.js";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/native-live-mac-runtime-executor.js";
import {
  NativeLiveMacBackgroundModelExecutor,
} from "../src/domains/bridge/native-live-mac-background-model-executor.js";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY before this smoke; it verifies the existing Claude subscription login path.",
  );
}

function finalText(events: readonly {
  type?: string;
  payload?: Record<string, unknown> | null;
}[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "result") continue;
    const text = event.payload?.final_text;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  return null;
}

async function run() {
  const root = await mkdtemp(
    path.join(tmpdir(), "leileios-agent-sdk-default-"),
  );

  const environment = { ...process.env };
  delete environment.LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT;

  try {
    assert.equal(
      resolveNativeLiveMacClaudeTransportKind(environment),
      "agent_sdk",
      "Mac daemon transport no longer defaults to Agent SDK.",
    );
    assert.equal(
      resolveNativeLiveMacClaudeTransportKind({
        ...environment,
        LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: "headless",
      }),
      "headless",
      "Explicit headless rollback selector is unavailable.",
    );

    const selected =
      await createNativeLiveMacClaudeTransport(
        environment,
        root,
      );

    assert.equal(selected.kind, "agent_sdk");
    assert.equal(
      selected.runtime.constructor.name,
      "AgentSdkClaudeTransport",
    );

    const foregroundMarker =
      "LEILEIOS_DAEMON_AGENT_SDK_FOREGROUND";
    const executor =
      new NativeLiveMacRuntimeExecutor(selected.runtime);
    const foreground = await executor.execute({
      protocol_version: 1,
      dispatch_target: "claude_code",
      prepare_id: randomUUID(),
      request_id: randomUUID(),
      operation: "send",
      conversation_id: randomUUID(),
      canonical_user_message_id: randomUUID(),
      runtime_mode: "new",
      parent_provider_session_id: null,
      prompt:
        `Reply with exactly ${foregroundMarker} and nothing else. Do not use tools.`,
    });

    assert.equal(
      foreground.status,
      "success",
      foreground.status === "failure"
        ? `Foreground daemon executor failed: ${foreground.error_code}`
        : undefined,
    );
    if (foreground.status !== "success") {
      throw new Error("Foreground daemon executor did not succeed.");
    }
    assert.ok(
      foreground.provider_session_id,
      "Foreground daemon executor returned no provider session.",
    );
    assert.equal(
      finalText(foreground.normalized_events),
      foregroundMarker,
      "Foreground normalized result did not preserve final text.",
    );

    const backgroundMarker =
      "LEILEIOS_DAEMON_AGENT_SDK_BACKGROUND";
    const backgroundExecutor =
      new NativeLiveMacBackgroundModelExecutor(
        selected.runtime,
      );
    const background = await backgroundExecutor.execute({
      protocol_version: 1,
      task_id: randomUUID(),
      task_kind: "distillation",
      prompt_contract_version:
        "agent-sdk-default-transport-smoke-v1",
      prompt:
        `Reply with exactly ${backgroundMarker} and nothing else. Do not use tools.`,
    });

    assert.equal(
      background.status,
      "success",
      background.status === "failure"
        ? `Background daemon executor failed: ${background.error_code}`
        : undefined,
    );
    if (background.status !== "success") {
      throw new Error("Background daemon executor did not succeed.");
    }
    assert.equal(
      background.final_text,
      backgroundMarker,
      "Background executor did not preserve final text.",
    );

    process.stdout.write(
      JSON.stringify(
        {
          outcome: "PASS",
          sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
          auth: "existing_claude_subscription_login",
          selection: {
            default: selected.kind,
            runtimeClass:
              selected.runtime.constructor.name,
            explicitRollback:
              resolveNativeLiveMacClaudeTransportKind({
                ...environment,
                LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT:
                  "headless",
              }),
          },
          foreground: {
            status: foreground.status,
            providerSessionId:
              foreground.provider_session_id,
            finalText:
              finalText(foreground.normalized_events),
            normalizedEventCount:
              foreground.normalized_events.length,
          },
          background: {
            status: background.status,
            taskKind: background.task_kind,
            finalText: background.final_text,
          },
          note:
            "The smoke uses the same transport factory as the Mac daemon and passes the selected Agent SDK runtime through the real foreground and background executor consumers. No relay or canonical production mutation is performed.",
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
