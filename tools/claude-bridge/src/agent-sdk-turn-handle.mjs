import { EventEmitter } from "node:events";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";
import {
  normalizeAgentSdkInterruptReceipt,
} from "./agent-sdk-interrupt.mjs";
import {
  assertPermissionCallbackQueryOptions,
  createAgentSdkPermissionCallback,
} from "./agent-sdk-permission.mjs";

function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

async function loadDefaultQuery() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.query !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose query().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.query;
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

function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sdkResultFailed(message) {
  if (!message || message.type !== "result") return false;
  if (message.is_error === true) return true;
  return typeof message.subtype === "string"
    && message.subtype !== "success";
}

export async function createAgentSdkTurnHandle({
  prompt,
  mode = "new",
  parentProviderSessionId = null,
  resume = null,
  forkSession = false,
  queryImpl = null,
  loadQuery = loadDefaultQuery,
  environment = process.env,
  cwd = process.cwd(),
  queryOptions = {},
  permissionHandler = null,
} = {}) {
  if (environment.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY must be unset; native live uses Claude subscription auth.",
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Agent SDK turn prompt must be nonblank.");
  }

  const resolvedQuery = queryImpl ?? await loadQuery();
  const events = new EventEmitter();

  let permissionCallback = null;
  if (permissionHandler !== null) {
    assertPermissionCallbackQueryOptions(
      queryOptions,
    );
    permissionCallback =
      createAgentSdkPermissionCallback({
        permissionHandler,
        events,
      });
  }

  async function* promptStream() {
    yield userMessage(prompt);
  }

  const options = {
    cwd,
    env: environment,
    settingSources: ["user", "project", "local"],
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
    },
    ...queryOptions,
    ...(
      permissionCallback
        ? { canUseTool: permissionCallback }
        : {}
    ),
    ...(resume ? { resume } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  };

  let query;
  try {
    query = resolvedQuery({
      prompt: promptStream(),
      options,
    });
  } catch (cause) {
    throw runtimeError(
      `Failed to start Claude Agent SDK turn: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
    );
  }

  if (!query || typeof query[Symbol.asyncIterator] !== "function") {
    throw runtimeError(
      "Claude Agent SDK query() did not return an async iterable.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return new AgentSdkTurnHandle({
    query,
    mode,
    parentProviderSessionId,
    events,
  });
}

export class AgentSdkTurnHandle {
  constructor({
    query,
    mode,
    parentProviderSessionId,
    events = new EventEmitter(),
  }) {
    this.query = query;
    this.mode = mode;
    this.parentProviderSessionId = parentProviderSessionId;
    this.events = events;
    this.providerSessionId = null;
    this.interruptReceipt = null;
    this.interruptRequested = false;
    this.abortRequested = false;
    this.closed = false;
    this.started = false;
    this.completion = null;
  }

  start() {
    if (this.started) return this.completion;
    if (this.closed) {
      throw runtimeError(
        "Agent SDK turn handle is already closed.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    this.started = true;
    this.completion = this.#consume();
    return this.completion;
  }

  async interrupt() {
    if (!this.started || !this.completion) {
      throw runtimeError(
        "Agent SDK turn has not started.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (this.closed) {
      throw runtimeError(
        "Agent SDK turn is already terminal.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (this.abortRequested) {
      throw runtimeError(
        "Agent SDK turn is already being hard-aborted.",
        { runtimeCode: "ABORTED" },
      );
    }
    if (typeof this.query.interrupt !== "function") {
      throw runtimeError(
        "Claude Agent SDK Query does not expose interrupt().",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    this.interruptRequested = true;
    const receipt = normalizeAgentSdkInterruptReceipt(
      await this.query.interrupt(),
    );
    this.interruptReceipt = receipt;
    this.events.emit("interrupt", receipt);
    return receipt;
  }

  abort() {
    if (this.closed) return;
    this.abortRequested = true;
    this.query.close?.();
    if (!this.started) {
      this.closed = true;
    }
  }

  async #consume() {
    const parsedEvents = [];
    const normalizedEvents = [];
    const normalizer = new ClaudeEventNormalizer({
      logicalConversationId: null,
      mode: this.mode,
      parentProviderSessionId:
        this.parentProviderSessionId,
    });
    let terminalResult = null;
    let terminalFailure = null;

    try {
      for await (const message of this.query) {
        parsedEvents.push(message);
        this.providerSessionId =
          this.providerSessionId
          ?? nonblankString(message?.session_id)
          ?? nonblankString(message?.sessionId);

        this.events.emit("event", message);
        const next = normalizer.normalize(message);
        normalizedEvents.push(...next);
        for (const event of next) {
          this.events.emit("normalized-event", event);
        }

        if (message?.type === "result") {
          terminalResult = message;
        }
        if (sdkResultFailed(message)) {
          terminalFailure = message;
        }
      }
    } catch (cause) {
      if (this.abortRequested) {
        throw runtimeError(
          "Claude Agent SDK turn was aborted.",
          {
            runtimeCode: "ABORTED",
            cause,
            providerSessionId: this.providerSessionId,
            events: parsedEvents,
            normalizedEvents,
          },
        );
      }
      if (this.interruptReceipt) {
        throw runtimeError(
          "Claude Agent SDK turn was interrupted.",
          {
            runtimeCode: "INTERRUPTED",
            cause,
            providerSessionId: this.providerSessionId,
            interruptReceipt: this.interruptReceipt,
            result: terminalFailure,
            events: parsedEvents,
            normalizedEvents,
          },
        );
      }
      throw runtimeError(
        `Claude Agent SDK turn failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          cause,
          providerSessionId: this.providerSessionId,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    } finally {
        this.closed = true;
    }

    if (this.abortRequested) {
      throw runtimeError(
        "Claude Agent SDK turn was aborted.",
        {
          runtimeCode: "ABORTED",
          providerSessionId: this.providerSessionId,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    }

    if (
      this.interruptReceipt
      && (
        terminalFailure
        || !terminalResult
        || terminalResult.subtype !== "success"
      )
    ) {
      throw runtimeError(
        "Claude Agent SDK turn was interrupted.",
        {
          runtimeCode: "INTERRUPTED",
          providerSessionId: this.providerSessionId,
          interruptReceipt: this.interruptReceipt,
          result: terminalFailure ?? terminalResult,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    }

    if (terminalFailure) {
      throw runtimeError(
        "Claude Agent SDK turn failed.",
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          providerSessionId: this.providerSessionId,
          result: terminalFailure,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    }

    return {
      providerSessionId: this.providerSessionId,
      events: parsedEvents,
      normalizedEvents,
      result: terminalResult,
    };
  }
}
