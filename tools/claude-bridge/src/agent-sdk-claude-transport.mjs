import { EventEmitter } from "node:events";
import { ClaudeTransport } from "./claude-transport.mjs";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";

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

function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function sdkResultFailed(message) {
  if (!message || message.type !== "result") return false;
  if (message.is_error === true) return true;
  return typeof message.subtype === "string" && message.subtype !== "success";
}

function sdkFailureMessage(message) {
  const errors = Array.isArray(message?.errors)
    ? message.errors.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (errors.length > 0) return errors.join("; ");
  const subtype = nonblankString(message?.subtype);
  return subtype
    ? `Claude Agent SDK result ended with ${subtype}.`
    : "Claude Agent SDK result reported an execution error.";
}

/**
 * Claude Agent SDK parity adapter.
 *
 * Phase 1 intentionally preserves the existing LeileiOS runtime contract:
 * sendNew/resume/fork each return only after one turn is terminal, while
 * normalized events and provider session identity retain the same shape used
 * by HeadlessClaudeTransport. Mid-turn input/interrupt semantics belong to a
 * later runtime-contract expansion.
 */
export class AgentSdkClaudeTransport extends ClaudeTransport {
  constructor({
    queryImpl = null,
    loadQuery = loadDefaultQuery,
    environment = process.env,
    cwd = process.cwd(),
  } = {}) {
    super();
    if (environment.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY must be unset; native live uses Claude subscription auth.",
      );
    }
    this.queryImpl = queryImpl;
    this.loadQuery = loadQuery;
    this.environment = environment;
    this.cwd = cwd;
    this.events = new EventEmitter();
    this.activeQuery = null;
    this.abortRequested = false;
  }

  sendNew(prompt) {
    return this.#run(prompt, { mode: "new" });
  }

  resume(sessionId, prompt) {
    return this.#run(prompt, {
      mode: "resume",
      parentProviderSessionId: sessionId,
      resume: sessionId,
    });
  }

  async fork(sessionId, prompt) {
    const result = await this.#run(prompt, {
      mode: "fork",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      forkSession: true,
    });
    if (!result.providerSessionId || result.providerSessionId === sessionId) {
      throw runtimeError(
        "Claude Agent SDK fork returned the same provider session id as its parent.",
        {
          runtimeCode: "PROVIDER_SESSION_CONFLICT",
          parentSessionId: sessionId,
          forkSessionId: result.providerSessionId,
          ...result,
        },
      );
    }
    return result;
  }

  abort() {
    this.abortRequested = true;
    this.activeQuery?.close?.();
  }

  async #resolveQuery() {
    if (this.queryImpl) return this.queryImpl;
    try {
      this.queryImpl = await this.loadQuery();
      return this.queryImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #run(
    prompt,
    {
      mode = "new",
      parentProviderSessionId = null,
      resume = null,
      forkSession = false,
    } = {},
  ) {
    if (this.activeQuery) {
      throw runtimeError(
        "Claude Agent SDK transport already has an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    this.abortRequested = false;
    const queryImpl = await this.#resolveQuery();
    if (this.abortRequested) {
      throw runtimeError(
        "Claude Agent SDK turn was aborted before startup completed.",
        { runtimeCode: "ABORTED" },
      );
    }

    const options = {
      cwd: this.cwd,
      env: this.environment,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      verbatimPrompts: true,
      ...(resume ? { resume } : {}),
      ...(forkSession ? { forkSession: true } : {}),
    };

    let activeQuery;
    try {
      activeQuery = queryImpl({ prompt, options });
    } catch (cause) {
      throw runtimeError(
        `Failed to start Claude Agent SDK query: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }

    if (!activeQuery || typeof activeQuery[Symbol.asyncIterator] !== "function") {
      throw runtimeError(
        "Claude Agent SDK query() did not return an async iterable.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    this.activeQuery = activeQuery;
    const parsedEvents = [];
    const normalizedEvents = [];
    const normalizer = new ClaudeEventNormalizer({
      logicalConversationId: null,
      mode,
      parentProviderSessionId,
    });
    let providerSessionId = null;
    let terminalFailure = null;

    try {
      for await (const message of activeQuery) {
        parsedEvents.push(message);
        providerSessionId =
          providerSessionId
          ?? nonblankString(message?.session_id)
          ?? nonblankString(message?.sessionId);

        this.events.emit("event", message);
        const nextNormalizedEvents = normalizer.normalize(message);
        normalizedEvents.push(...nextNormalizedEvents);
        for (const normalizedEvent of nextNormalizedEvents) {
          this.events.emit("normalized-event", normalizedEvent);
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
            events: parsedEvents,
            normalizedEvents,
          },
        );
      }
      throw runtimeError(
        `Claude Agent SDK query failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          cause,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    } finally {
      if (this.activeQuery === activeQuery) {
        this.activeQuery = null;
      }
    }

    if (this.abortRequested) {
      throw runtimeError(
        "Claude Agent SDK turn was aborted.",
        {
          runtimeCode: "ABORTED",
          events: parsedEvents,
          normalizedEvents,
        },
      );
    }

    if (terminalFailure) {
      throw runtimeError(
        sdkFailureMessage(terminalFailure),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          result: terminalFailure,
          events: parsedEvents,
          normalizedEvents,
        },
      );
    }

    this.events.emit("exit", {
      code: 0,
      signal: null,
    });

    return {
      providerSessionId,
      events: parsedEvents,
      normalizedEvents,
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  }
}
