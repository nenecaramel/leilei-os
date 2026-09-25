import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import {
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ClaudeEventNormalizer,
} from "../src/normalized-events.mjs";

if (process.env.ANTHROPIC_API_KEY) {
  throw new Error(
    "Unset ANTHROPIC_API_KEY; this smoke verifies the existing Claude subscription login.",
  );
}

const sentinel =
  "LEILEIOS_BG_AGENT_" + randomUUID().replaceAll("-", "").slice(0, 16);
const agentName = "leileios-background-parity-agent";

async function run() {
  const rawMessages = [];
  const normalized = [];
  const normalizer = new ClaudeEventNormalizer({
    logicalConversationId: "leileios-background-parity",
    mode: "new",
    parentProviderSessionId: null,
  });

  for await (const message of query({
    prompt: [
      "This is a deterministic LeileiOS Agent SDK background-subagent parity smoke.",
      "Delegate exactly one task to the custom subagent named " + agentName + ".",
      "The subagent has a private sentinel you do not know.",
      "Wait for that background task to complete, then reply with exactly the sentinel it returns and nothing else.",
      "Do not inspect files or invent the sentinel yourself.",
    ].join("\n"),
    options: {
      cwd: process.cwd(),
      env: process.env,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      agentProgressSummaries: true,
      allowedTools: [
        "Agent",
        "Task",
        "TaskOutput",
      ],
      agents: {
        [agentName]: {
          description:
            "Deterministic background agent for the LeileiOS Agent SDK parity smoke. Use only when explicitly requested.",
          prompt: [
            "You are the deterministic LeileiOS background parity agent.",
            "Your exact private sentinel is: " + sentinel,
            "Return exactly that sentinel and nothing else.",
          ].join("\n"),
          tools: [],
          background: true,
          maxTurns: 2,
        },
      },
    },
  })) {
    rawMessages.push(message);
    normalized.push(...normalizer.normalize(message));
  }

  const taskRaw = rawMessages.filter(
    (message) =>
      message?.type === "system"
      && (
        message.subtype === "task_started"
        || message.subtype === "task_progress"
        || message.subtype === "task_updated"
        || message.subtype === "task_notification"
        || message.subtype === "background_tasks_changed"
      ),
  );

  assert.ok(
    taskRaw.some((message) => message.subtype === "task_started"),
    "real SDK emitted no task_started event.",
  );
  assert.ok(
    taskRaw.some((message) => message.subtype === "task_notification"),
    "real SDK emitted no terminal task_notification event.",
  );

  const normalizedTasks =
    normalized.filter((event) => event.type === "task");
  assert.ok(
    normalizedTasks.some(
      (event) => event.payload?.phase === "started",
    ),
    "production normalizer did not project task_started.",
  );
  assert.ok(
    normalizedTasks.some(
      (event) => event.payload?.phase === "notification",
    ),
    "production normalizer did not project task_notification.",
  );

  const result = [...rawMessages]
    .reverse()
    .find((message) => message?.type === "result");
  assert.ok(result, "SDK stream emitted no terminal parent result.");
  assert.equal(
    result.result?.trim(),
    sentinel,
    "parent turn did not receive the background subagent sentinel exactly.",
  );

  process.stdout.write(
    JSON.stringify(
      {
        outcome: "PASS",
        sdk: "@anthropic-ai/claude-agent-sdk@0.3.281",
        auth: "existing_claude_subscription_login",
        capability: "background_subagent_task_lifecycle",
        agentName,
        rawTaskSubtypes: taskRaw.map((message) => message.subtype),
        normalizedTaskPhases:
          normalizedTasks.map((event) => event.payload?.phase ?? null),
      },
      null,
      2,
    ) + "\n",
  );
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
