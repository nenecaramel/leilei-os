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

const EXPECTED =
  "LEILEIOS_ASK_USER_QUESTION_DARK";

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

function optionLabels(question) {
  return (question?.options ?? [])
    .map((option) => option?.label)
    .filter(
      (label) =>
        typeof label === "string",
    );
}

async function run() {
  let stage = "create_handle";
  let handle = null;
  let forceExitTimer = null;

  const requests = [];
  const requestEvents = [];
  const decisionEvents = [];
  let signalSeen = false;

  const setStage = (next) => {
    stage = next;
    process.stderr.write(
      `[ask-user-question-smoke] stage=${next}\n`,
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
            "Agent SDK AskUserQuestion smoke exceeded 60 seconds. The active turn was hard-aborted.",
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
        "This is a deterministic LeileiOS AskUserQuestion smoke.",
        "Use the AskUserQuestion tool exactly once.",
        "Ask exactly one question: Which theme should this smoke choose?",
        "Provide exactly two options labeled Light and Dark.",
        "Do not answer the question yourself.",
        "After the user answers, if the answer is Dark reply exactly:",
        EXPECTED,
        "If the answer is Light reply exactly LEILEIOS_ASK_USER_QUESTION_LIGHT.",
        "Do not use any other tool.",
      ].join("\n"),
      environment: process.env,
      queryOptions: {
        model: "claude-sonnet-5",
        effort: "low",
        settingSources: [],
        permissionMode: "plan",
        tools: ["AskUserQuestion"],
        verbatimPrompts: true,
      },
      questionHandler: async (
        request,
        { signal },
      ) => {
        requests.push(request);
        signalSeen = Boolean(
          signal
          && typeof signal.aborted
            === "boolean",
        );

        assert.equal(
          request.toolName,
          "AskUserQuestion",
        );
        assert.ok(
          typeof request.toolUseId
            === "string"
          && request.toolUseId.length > 0,
          "Real SDK question request must expose toolUseId.",
        );
        assert.ok(
          typeof request.requestId
            === "string"
          && request.requestId.length > 0,
          "Real SDK question request must expose requestId.",
        );
        assert.equal(
          request.questions.length,
          1,
        );

        const question =
          request.questions[0];
        assert.equal(
          question.question,
          "Which theme should this smoke choose?",
        );
        const labels =
          optionLabels(question);
        assert.ok(
          labels.includes("Light"),
          "AskUserQuestion did not include Light.",
        );
        assert.ok(
          labels.includes("Dark"),
          "AskUserQuestion did not include Dark.",
        );

        return {
          decision: "answer",
          answers: {
            [question.question]: "Dark",
          },
        };
      },
    });

    handle.events.on(
      "question-request",
      (request) => {
        requestEvents.push(request);
      },
    );
    handle.events.on(
      "question-decision",
      (payload) => {
        decisionEvents.push(payload);
      },
    );

    setStage("start");
    const result = await handle.start();

    setStage("assert");
    assert.equal(
      requests.length,
      1,
      "Real SDK did not invoke questionHandler exactly once.",
    );
    assert.equal(
      requestEvents.length,
      1,
    );
    assert.equal(
      decisionEvents.length,
      1,
    );
    assert.equal(signalSeen, true);
    assert.deepEqual(
      decisionEvents[0].decision,
      {
        decision: "answer",
        answers: {
          "Which theme should this smoke choose?":
            "Dark",
        },
      },
    );
    assert.equal(
      finalText(result),
      EXPECTED,
      "Terminal answer did not use the answer returned by questionHandler.",
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
            "dedicated_agent_sdk_ask_user_question",
          providerSessionId:
            result.providerSessionId,
          requestCount:
            requests.length,
          toolName:
            requests[0]?.toolName
            ?? null,
          toolUseId:
            requests[0]?.toolUseId
            ?? null,
          requestId:
            requests[0]?.requestId
            ?? null,
          signalSeen,
          question:
            requests[0]
              ?.questions?.[0]
              ?.question
            ?? null,
          optionLabels:
            optionLabels(
              requests[0]
                ?.questions?.[0],
            ),
          selectedAnswer: "Dark",
          finalText:
            finalText(result),
          expectedFinalText: EXPECTED,
          sameQueryRoundTrip:
            finalText(result)
            === EXPECTED,
          note:
            "AskUserQuestion was surfaced through the host questionHandler, answered asynchronously with updatedInput.answers, and the same Query continued to the expected terminal answer.",
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
