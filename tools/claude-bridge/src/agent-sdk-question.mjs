function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

function nonblankString(value) {
  return typeof value === "string" && value.trim()
    ? value
    : null;
}

function normalizeContextId(
  context,
  ...keys
) {
  for (const key of keys) {
    const value = nonblankString(
      context?.[key],
    );
    if (value) return value;
  }
  return null;
}

function normalizeQuestions(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw runtimeError(
      "AskUserQuestion request must contain at least one question.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return value.map((question, index) => {
    if (
      !question
      || typeof question !== "object"
      || Array.isArray(question)
    ) {
      throw runtimeError(
        `AskUserQuestion question ${index} must be an object.`,
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    const text = nonblankString(
      question.question,
    );
    if (!text) {
      throw runtimeError(
        `AskUserQuestion question ${index} is missing question text.`,
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    return {
      ...question,
      question: text,
      options:
        Array.isArray(question.options)
          ? question.options
          : [],
      multiSelect:
        question.multiSelect === true,
    };
  });
}

export function normalizeAgentSdkQuestionRequest(
  toolName,
  input,
  context = {},
) {
  if (toolName !== "AskUserQuestion") {
    throw runtimeError(
      "Question callback received a non-AskUserQuestion tool.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (
    !input
    || typeof input !== "object"
    || Array.isArray(input)
  ) {
    throw runtimeError(
      "AskUserQuestion input must be an object.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return {
    toolName: "AskUserQuestion",
    input,
    questions:
      normalizeQuestions(input.questions),
    toolUseId: normalizeContextId(
      context,
      "toolUseID",
      "toolUseId",
      "tool_use_id",
    ),
    requestId: normalizeContextId(
      context,
      "requestId",
      "requestID",
      "request_id",
    ),
    agentId: normalizeContextId(
      context,
      "agentID",
      "agentId",
      "agent_id",
    ),
  };
}

function normalizeAnswers(value) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw runtimeError(
      "Question answer decision requires an answers object.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw runtimeError(
      "Question answer decision requires at least one answer.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  const answers = {};
  for (const [question, answer] of entries) {
    const normalizedQuestion =
      nonblankString(question);
    const normalizedAnswer =
      nonblankString(answer);
    if (
      !normalizedQuestion
      || !normalizedAnswer
    ) {
      throw runtimeError(
        "Question answers must use nonblank string keys and values.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    answers[normalizedQuestion] =
      normalizedAnswer;
  }

  return answers;
}

export function normalizeLeileiQuestionDecision(
  decision,
) {
  if (!decision || typeof decision !== "object") {
    throw runtimeError(
      "LeileiOS question handler must return a decision object.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (decision.decision === "answer") {
    return {
      decision: "answer",
      answers:
        normalizeAnswers(decision.answers),
    };
  }

  if (decision.decision === "cancel") {
    const message = nonblankString(
      decision.message,
    );
    if (!message) {
      throw runtimeError(
        "Question cancel decision requires a nonblank message.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    return {
      decision: "cancel",
      message,
    };
  }

  throw runtimeError(
    "Question decision must be answer or cancel.",
    { runtimeCode: "RUNTIME_UNAVAILABLE" },
  );
}

export function projectLeileiQuestionDecisionToSdk(
  request,
  decision,
) {
  const normalized =
    normalizeLeileiQuestionDecision(
      decision,
    );

  if (normalized.decision === "answer") {
    return {
      behavior: "allow",
      updatedInput: {
        ...request.input,
        answers: normalized.answers,
      },
    };
  }

  return {
    behavior: "deny",
    message: normalized.message,
    interrupt: false,
  };
}

export function createAgentSdkQuestionCallback({
  questionHandler,
  events = null,
} = {}) {
  if (typeof questionHandler !== "function") {
    throw runtimeError(
      "questionHandler must be a function.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return async (
    toolName,
    input,
    context = {},
  ) => {
    const request =
      normalizeAgentSdkQuestionRequest(
        toolName,
        input,
        context,
      );

    events?.emit?.(
      "question-request",
      request,
    );

    let rawDecision;
    try {
      rawDecision = await questionHandler(
        request,
        {
          signal:
            context.signal ?? null,
        },
      );
    } catch (cause) {
      events?.emit?.(
        "question-error",
        {
          request,
          cause,
        },
      );
      throw cause;
    }

    const decision =
      normalizeLeileiQuestionDecision(
        rawDecision,
      );
    const sdkDecision =
      projectLeileiQuestionDecisionToSdk(
        request,
        decision,
      );

    events?.emit?.(
      "question-decision",
      {
        request,
        decision,
      },
    );

    return sdkDecision;
  };
}
