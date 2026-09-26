import assert from "node:assert/strict";
import {
  access,
  mkdir,
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

function summarizeTurn(result) {
  const toolUses = [];
  const toolErrors = [];
  let permissionDenials = [];
  let initPermissionMode = null;

  for (const message of result.events ?? []) {
    if (
      message?.type === "system"
      && message?.subtype === "init"
    ) {
      initPermissionMode =
        message.permissionMode
        ?? message.permission_mode
        ?? null;
    }

    if (
      message?.type === "assistant"
      && Array.isArray(
        message.message?.content,
      )
    ) {
      for (const block of message.message.content) {
        if (block?.type === "tool_use") {
          toolUses.push({
            name: block.name ?? null,
            id: block.id ?? null,
            input: block.input ?? null,
          });
        }
      }
    }

    if (
      message?.type === "user"
      && Array.isArray(
        message.message?.content,
      )
    ) {
      for (const block of message.message.content) {
        if (
          block?.type === "tool_result"
          && block.is_error === true
        ) {
          toolErrors.push({
            toolUseId:
              block.tool_use_id ?? null,
            content: block.content ?? null,
          });
        }
      }
    }

    if (
      message?.type === "result"
      && Array.isArray(
        message.permission_denials,
      )
    ) {
      permissionDenials =
        message.permission_denials;
    }
  }

  return {
    initPermissionMode,
    toolUses,
    toolErrors,
    permissionDenials,
    finalText: finalText(result),
  };
}

function assertPermissionRequest(request) {
  assert.equal(request.toolName, "Write");
  assert.ok(
    typeof request.toolUseId === "string"
      && request.toolUseId.length > 0,
    "Real SDK permission request must expose toolUseId.",
  );
  assert.ok(
    request.input
      && typeof request.input === "object",
    "Real SDK permission request must expose structured input.",
  );
}


async function run() {
  const root = await mkdtemp(
    path.join(
      tmpdir(),
      "leileios-agent-sdk-permission-",
    ),
  );
  const cwd = path.join(root, "workspace");
  const guarded = path.join(
    root,
    "outside-workspace",
  );
  await mkdir(cwd, { recursive: true });
  await mkdir(guarded, {
    recursive: true,
  });

  const deniedMarker = path.join(
    guarded,
    "denied-executed.txt",
  );
  const originalMarker = path.join(
    guarded,
    "original-executed.txt",
  );
  const rewrittenMarker = path.join(
    guarded,
    "rewritten-executed.txt",
  );

  let stage = "start";
  let activeHandle = null;
  let forceExitTimer = null;
  let timedOut = false;

  const setStage = (next) => {
    stage = next;
    process.stderr.write(
      `[permission-smoke] stage=${next}\n`,
    );
  };

  const watchdog = setTimeout(() => {
    timedOut = true;
    const failedStage = stage;
    activeHandle?.abort();
    process.stderr.write(
      JSON.stringify(
        {
          outcome: "FAIL",
          reason: "watchdog_timeout",
          stage: failedStage,
          message:
            "Agent SDK permission callback smoke exceeded 75 seconds. The active turn was hard-aborted.",
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
    setStage("deny_create_handle");
    const denyRequests = [];
    const denyRequestEvents = [];
    const denyDecisionEvents = [];
    let denySignalSeen = false;

    const denied = await createAgentSdkTurnHandle({
      prompt: [
        "This is a deterministic LeileiOS permission callback smoke.",
        "Use the Write tool exactly once.",
        `Write exactly the text LEILEIOS_PERMISSION_DENIED_EXECUTED to this file: ${deniedMarker}`,
        "If permission is denied, do not retry the tool.",
        "After the denial, reply with exactly LEILEIOS_PERMISSION_DENIED and nothing else.",
      ].join("\n"),
      cwd,
      environment: process.env,
      queryOptions: {
        permissionMode: "default",
        settingSources: [],
        tools: ["Write"],
        model: "claude-sonnet-5",
        effort: "low",
        verbatimPrompts: true,
      },
      permissionHandler: async (
        request,
        { signal },
      ) => {
        assertPermissionRequest(request);
        denyRequests.push(request);
        denySignalSeen =
          Boolean(
            signal
            && typeof signal.aborted
              === "boolean",
          );
        return {
          decision: "deny",
          message:
            "LEILEIOS_PERMISSION_DENY_TEST",
          interrupt: false,
        };
      },
    });
    activeHandle = denied;
    denied.events.on(
      "permission-request",
      (request) => {
        denyRequestEvents.push(request);
      },
    );
    denied.events.on(
      "permission-decision",
      (payload) => {
        denyDecisionEvents.push(payload);
      },
    );

    setStage("deny_start");
    const deniedResult = await denied.start();

    setStage("deny_assert");
    if (denyRequests.length < 1) {
      throw new Error(
        "Real SDK never invoked permissionHandler for denied Write. Diagnostic: "
        + JSON.stringify(
          summarizeTurn(deniedResult),
        ),
      );
    }
    assert.equal(
      denyRequestEvents.length,
      denyRequests.length,
    );
    assert.equal(
      denyDecisionEvents.length,
      denyRequests.length,
    );
    assert.equal(denySignalSeen, true);
    assert.equal(
      await fileExists(deniedMarker),
      false,
      "Denied Write unexpectedly executed.",
    );
    for (const event of denyDecisionEvents) {
      assert.equal(
        event.decision.decision,
        "deny",
      );
      assert.equal(
        event.decision.interrupt,
        false,
      );
    }

    setStage("allow_create_handle");
    const allowRequests = [];
    const allowRequestEvents = [];
    const allowDecisionEvents = [];
    let allowSignalSeen = false;

    const allowed = await createAgentSdkTurnHandle({
      prompt: [
        "This is a deterministic LeileiOS permission callback smoke.",
        "Use the Write tool exactly once.",
        `Write exactly the text LEILEIOS_PERMISSION_ORIGINAL to this file: ${originalMarker}`,
        "After the write completes, reply with exactly LEILEIOS_PERMISSION_ALLOWED and nothing else.",
      ].join("\n"),
      cwd,
      environment: process.env,
      queryOptions: {
        permissionMode: "default",
        settingSources: [],
        tools: ["Write"],
        model: "claude-sonnet-5",
        effort: "low",
        verbatimPrompts: true,
      },
      permissionHandler: async (
        request,
        { signal },
      ) => {
        assertPermissionRequest(request);
        allowRequests.push(request);
        allowSignalSeen =
          Boolean(
            signal
            && typeof signal.aborted
              === "boolean",
          );
        return {
          decision: "allow",
          updatedInput: {
            ...request.input,
            file_path: rewrittenMarker,
            content:
              "LEILEIOS_PERMISSION_REWRITTEN",
          },
        };
      },
    });
    activeHandle = allowed;
    allowed.events.on(
      "permission-request",
      (request) => {
        allowRequestEvents.push(request);
      },
    );
    allowed.events.on(
      "permission-decision",
      (payload) => {
        allowDecisionEvents.push(payload);
      },
    );

    setStage("allow_start");
    const allowedResult = await allowed.start();

    setStage("allow_assert");
    if (allowRequests.length < 1) {
      throw new Error(
        "Real SDK never invoked permissionHandler for allowed Write. Diagnostic: "
        + JSON.stringify(
          summarizeTurn(allowedResult),
        ),
      );
    }
    assert.equal(
      allowRequestEvents.length,
      allowRequests.length,
    );
    assert.equal(
      allowDecisionEvents.length,
      allowRequests.length,
    );
    assert.equal(allowSignalSeen, true);
    assert.equal(
      await fileExists(originalMarker),
      false,
      "Original Write target executed instead of updatedInput.",
    );
    assert.equal(
      await fileExists(rewrittenMarker),
      true,
      "Permission callback updatedInput Write was not executed.",
    );
    for (const event of allowDecisionEvents) {
      assert.equal(
        event.decision.decision,
        "allow",
      );
    }

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
            "dedicated_agent_sdk_permission_callback",
          deny: {
            requestCount:
              denyRequests.length,
            toolName:
              denyRequests[0]?.toolName
              ?? null,
            toolUseId:
              denyRequests[0]?.toolUseId
              ?? null,
            requestId:
              denyRequests[0]?.requestId
              ?? null,
            signalSeen:
              denySignalSeen,
            markerCreated:
              await fileExists(
                deniedMarker,
              ),
            finalText:
              finalText(deniedResult),
          },
          allow: {
            requestCount:
              allowRequests.length,
            toolName:
              allowRequests[0]?.toolName
              ?? null,
            toolUseId:
              allowRequests[0]?.toolUseId
              ?? null,
            requestId:
              allowRequests[0]?.requestId
              ?? null,
            signalSeen:
              allowSignalSeen,
            originalMarkerCreated:
              await fileExists(
                originalMarker,
              ),
            rewrittenMarkerCreated:
              await fileExists(
                rewrittenMarker,
              ),
            finalText:
              finalText(allowedResult),
          },
          policyBoundary: {
            noAllowedToolsShadowing: true,
            noBypassPermissions: true,
            noPersistentPermissionUpdates:
              true,
            outOfBandNullResponse:
              "not_in_this_slice",
          },
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    clearTimeout(watchdog);
    if (!timedOut && forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
    activeHandle?.abort();
    await rm(root, {
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
