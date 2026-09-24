import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createAgentSdkQuestionCallback,
  normalizeAgentSdkQuestionRequest,
  normalizeLeileiQuestionDecision,
  projectLeileiQuestionDecisionToSdk,
} from "../src/agent-sdk-question.mjs";

test("AskUserQuestion request normalizes stable host fields", () => {
  const input = {
    questions: [
      {
        question: "Which theme?",
        header: "Theme",
        options: [
          {
            label: "Light",
            description: "Light theme",
          },
          {
            label: "Dark",
            description: "Dark theme",
          },
        ],
        multiSelect: false,
      },
    ],
  };

  const request =
    normalizeAgentSdkQuestionRequest(
      "AskUserQuestion",
      input,
      {
        toolUseID: "toolu_question",
        requestId: "req_question",
        agentID: "agent_question",
      },
    );

  assert.equal(
    request.toolUseId,
    "toolu_question",
  );
  assert.equal(
    request.requestId,
    "req_question",
  );
  assert.equal(
    request.agentId,
    "agent_question",
  );
  assert.equal(
    request.questions[0].question,
    "Which theme?",
  );
  assert.equal(
    request.questions[0].multiSelect,
    false,
  );
  assert.equal(
    request.questions[0].options.length,
    2,
  );
});

test("question answers project into AskUserQuestion updatedInput", () => {
  const request =
    normalizeAgentSdkQuestionRequest(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which theme?",
            options: [],
            multiSelect: false,
          },
        ],
      },
      {},
    );

  assert.deepEqual(
    projectLeileiQuestionDecisionToSdk(
      request,
      {
        decision: "answer",
        answers: {
          "Which theme?": "Dark",
        },
      },
    ),
    {
      behavior: "allow",
      updatedInput: {
        questions: [
          {
            question: "Which theme?",
            options: [],
            multiSelect: false,
          },
        ],
        answers: {
          "Which theme?": "Dark",
        },
      },
    },
  );

  assert.deepEqual(
    projectLeileiQuestionDecisionToSdk(
      request,
      {
        decision: "cancel",
        message: "User dismissed the question.",
      },
    ),
    {
      behavior: "deny",
      message:
        "User dismissed the question.",
      interrupt: false,
    },
  );
});

test("question callback emits request and decision events and exposes signal", async () => {
  const events = new EventEmitter();
  const observed = [];
  events.on(
    "question-request",
    (request) => {
      observed.push({
        type: "request",
        request,
      });
    },
  );
  events.on(
    "question-decision",
    (payload) => {
      observed.push({
        type: "decision",
        payload,
      });
    },
  );

  const controller = new AbortController();
  let signalSeen = null;

  const callback =
    createAgentSdkQuestionCallback({
      events,
      questionHandler: async (
        request,
        { signal },
      ) => {
        signalSeen = signal;
        return {
          decision: "answer",
          answers: {
            [request.questions[0].question]:
              "Dark",
          },
        };
      },
    });

  const result = await callback(
    "AskUserQuestion",
    {
      questions: [
        {
          question: "Which theme?",
          options: [],
          multiSelect: false,
        },
      ],
    },
    {
      signal: controller.signal,
      toolUseID: "toolu_callback",
      requestId: "req_callback",
    },
  );

  assert.equal(
    signalSeen,
    controller.signal,
  );
  assert.deepEqual(result, {
    behavior: "allow",
    updatedInput: {
      questions: [
        {
          question: "Which theme?",
          options: [],
          multiSelect: false,
        },
      ],
      answers: {
        "Which theme?": "Dark",
      },
    },
  });
  assert.equal(observed.length, 2);
  assert.equal(
    observed[0].request.toolUseId,
    "toolu_callback",
  );
});

test("question callback emits question-error and rethrows handler failures", async () => {
  const events = new EventEmitter();
  let emitted = null;
  events.on(
    "question-error",
    (payload) => {
      emitted = payload;
    },
  );

  const cause =
    new Error("question UI unavailable");
  const callback =
    createAgentSdkQuestionCallback({
      events,
      questionHandler: async () => {
        throw cause;
      },
    });

  await assert.rejects(
    callback(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which theme?",
            options: [],
          },
        ],
      },
      {
        toolUseID: "toolu_error",
      },
    ),
    (error) => error === cause,
  );

  assert.equal(emitted.cause, cause);
  assert.equal(
    emitted.request.toolUseId,
    "toolu_error",
  );
});

test("question contract rejects malformed requests and decisions", () => {
  assert.throws(
    () =>
      normalizeAgentSdkQuestionRequest(
        "Bash",
        {},
        {},
      ),
    /non-AskUserQuestion/,
  );

  assert.throws(
    () =>
      normalizeAgentSdkQuestionRequest(
        "AskUserQuestion",
        { questions: [] },
        {},
      ),
    /at least one question/,
  );

  assert.throws(
    () =>
      normalizeLeileiQuestionDecision({
        decision: "answer",
        answers: {},
      }),
    /at least one answer/,
  );

  assert.throws(
    () =>
      normalizeLeileiQuestionDecision({
        decision: "cancel",
        message: " ",
      }),
    /nonblank message/,
  );
});
