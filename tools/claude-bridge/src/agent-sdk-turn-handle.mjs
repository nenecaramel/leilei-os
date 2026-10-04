import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";
import {
  normalizeAgentSdkInterruptReceipt,
} from "./agent-sdk-interrupt.mjs";
import {
  assertInteractiveCallbackQueryOptions,
  createAgentSdkPermissionCallback,
} from "./agent-sdk-permission.mjs";
import {
  createAgentSdkQuestionCallback,
} from "./agent-sdk-question.mjs";

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

function userMessage(text, uuid) {
  return {
    type: "user",
    uuid,
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

function createAgentSdkInputQueue(initialMessage) {
  const queued = [initialMessage];
  let waiter = null;
  let ended = false;

  return {
    push(message) {
      if (ended) {
        throw runtimeError(
          "Agent SDK input queue is already closed.",
          { runtimeCode: "RUNTIME_UNAVAILABLE" },
        );
      }
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve({
          value: message,
          done: false,
        });
        return;
      }
      queued.push(message);
    },

    end() {
      if (ended) return;
      ended = true;
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve({
          value: undefined,
          done: true,
        });
      }
    },

    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queued.length > 0) {
            return Promise.resolve({
              value: queued.shift(),
              done: false,
            });
          }
          if (ended) {
            return Promise.resolve({
              value: undefined,
              done: true,
            });
          }
          return new Promise((resolve) => {
            waiter = resolve;
          });
        },
      };
    },
  };
}

function sdkResultFailed(message) {
  if (!message || message.type !== "result") return false;
  if (message.is_error === true) return true;
  return typeof message.subtype === "string"
    && message.subtype !== "success";
}

export async function waitForAgentSdkMcpServer(
  query,
  serverName,
  {
    timeoutMs = 8_000,
    pollMs = 200,
    probeTimeoutMs = 1_000,
  } = {},
) {
  if (!query || typeof query.mcpServerStatus !== "function") {
    throw runtimeError(
      "Claude Agent SDK Query does not expose MCP status control.",
      {
        runtimeCode: "RUNTIME_UNAVAILABLE",
        mcpServerName: serverName,
      },
    );
  }

  const deadline = Date.now() + timeoutMs;
  const maxReconnectDelayMs = 5_000;
  let reconnectDelayMs = Math.max(pollMs, 200);
  let nextReconnectAt = 0;
  let lastStatus = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const statuses = await withTimeout(
        Promise.resolve(query.mcpServerStatus()),
        probeTimeoutMs,
      );
      const status = Array.isArray(statuses)
        ? statuses.find((item) => item?.name === serverName)
        : null;
      lastStatus = status?.status ?? null;
      lastError =
        typeof status?.error === "string" ? status.error : null;

      if (lastStatus === "connected") return;
      if (
        (lastStatus === "failed" || lastStatus === "needs-auth")
        && typeof query.reconnectMcpServer === "function"
        && Date.now() >= nextReconnectAt
      ) {
        try {
          await withTimeout(
            Promise.resolve(query.reconnectMcpServer(serverName)),
            probeTimeoutMs,
          );
        } catch (cause) {
          lastError =
            cause instanceof Error ? cause.message : String(cause);
        }
        nextReconnectAt = Date.now() + reconnectDelayMs;
        reconnectDelayMs = Math.min(
          reconnectDelayMs * 2,
          maxReconnectDelayMs,
        );
      }
      if (lastStatus === "disabled") {
        break;
      }
    } catch (cause) {
      lastError =
        cause instanceof Error ? cause.message : String(cause);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollMs, remainingMs))
    );
  }

  throw runtimeError(
    "LeileiOS MCP did not connect before the Claude turn started.",
    {
      runtimeCode: "RUNTIME_UNAVAILABLE",
      mcpServerName: serverName,
      mcpStatus: lastStatus,
      mcpError: lastError,
    },
  );
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("MCP control request timed out.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  questionHandler = null,
  trustedReadPaths = [],
  streaming = false,
  midTurnInput = false,
  userMessageUuid = null,
  executionReadback = false,
  mcpStartupTimeoutMs = 120_000,
} = {}) {
  if (environment.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY must be unset; native live uses Claude subscription auth.",
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("Agent SDK turn prompt must be nonblank.");
  }
  if (typeof streaming !== "boolean") {
    throw new Error("Agent SDK turn streaming must be boolean.");
  }
  if (typeof midTurnInput !== "boolean") {
    throw new Error("Agent SDK turn midTurnInput must be boolean.");
  }
  if (typeof executionReadback !== "boolean") {
    throw new Error("Agent SDK turn executionReadback must be boolean.");
  }
  if (
    !Number.isFinite(mcpStartupTimeoutMs)
    || mcpStartupTimeoutMs <= 0
  ) {
    throw new Error("Agent SDK MCP startup timeout must be positive.");
  }
  const initialUserMessageUuid =
    nonblankString(userMessageUuid) ?? randomUUID();

  if (
    streaming
    && queryOptions.includePartialMessages === false
  ) {
    throw new Error(
      "streaming: true cannot be combined with includePartialMessages: false.",
    );
  }

  const resolvedQuery = queryImpl ?? await loadQuery();
  const events = new EventEmitter();

  let permissionCallback = null;
  let questionCallback = null;

  if (
    permissionHandler !== null
    || questionHandler !== null
  ) {
    assertInteractiveCallbackQueryOptions(
      queryOptions,
      "interactive host callbacks",
    );
  }

  if (permissionHandler !== null) {
    permissionCallback =
      createAgentSdkPermissionCallback({
        permissionHandler,
        events,
        trustedReadPaths,
      });
  }

  if (questionHandler !== null) {
    questionCallback =
      createAgentSdkQuestionCallback({
        questionHandler,
        events,
      });
  }

  const interactiveCallback =
    permissionCallback || questionCallback
      ? async (
          toolName,
          input,
          context = {},
        ) => {
          if (
            toolName === "AskUserQuestion"
            && questionCallback
          ) {
            return questionCallback(
              toolName,
              input,
              context,
            );
          }

          if (permissionCallback) {
            return permissionCallback(
              toolName,
              input,
              context,
            );
          }

          return {
            behavior: "deny",
            message:
              "LeileiOS has no permission handler configured for this tool request.",
            interrupt: false,
          };
        }
      : null;

  const inputQueue = midTurnInput
    ? createAgentSdkInputQueue(
        userMessage(prompt, initialUserMessageUuid),
      )
    : null;

  async function* promptStream() {
    yield userMessage(prompt, initialUserMessageUuid);
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
    ...(streaming
      ? { includePartialMessages: true }
      : {}),
    ...(
      interactiveCallback
        ? { canUseTool: interactiveCallback }
        : {}
    ),
    ...(resume ? { resume } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  };

  let query;
  try {
    query = resolvedQuery({
      prompt:
        inputQueue
        ?? (
          queryOptions.verbatimPrompts === false
            ? prompt
            : promptStream()
        ),
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

  if (queryOptions.mcpServers?.leileios) {
    try {
      await waitForAgentSdkMcpServer(
        query,
        "leileios",
        { timeoutMs: mcpStartupTimeoutMs },
      );
    } catch (cause) {
      try {
        await query.close?.();
      } catch {
        // Preserve the MCP startup failure; close is best-effort cleanup.
      }
      throw cause;
    }
  }

  return new AgentSdkTurnHandle({
    query,
    mode,
    parentProviderSessionId,
    events,
    inputQueue,
    midTurnInput,
    executionReadback,
  });
}

export class AgentSdkTurnHandle {
  constructor({
    query,
    mode,
    parentProviderSessionId,
    events = new EventEmitter(),
    inputQueue = null,
    midTurnInput = false,
    executionReadback = false,
  }) {
    this.query = query;
    this.mode = mode;
    this.parentProviderSessionId = parentProviderSessionId;
    this.events = events;
    this.inputQueue = inputQueue;
    this.midTurnInput = midTurnInput;
    this.executionReadback = executionReadback;
    this.providerSessionId = null;
    this.interruptReceipt = null;
    this.interruptRequested = false;
    this.abortRequested = false;
    this.closed = false;
    this.started = false;
    this.completion = null;
    this.rawContextUsage = null;
    this.contextUsageError = null;
    this.rawExecutionSettings = null;
    this.rawSupportedModels = null;
    this.executionReadbackError = null;
    this.executionReadbackSampled = false;
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

  sendUserMessage(text, { uuid = null } = {}) {
    if (!this.midTurnInput || !this.inputQueue) {
      throw runtimeError(
        "Agent SDK turn does not have mid-turn input enabled.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (!this.started || !this.completion) {
      throw runtimeError(
        "Agent SDK turn has not started.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (
      this.closed
      || this.abortRequested
      || this.interruptRequested
    ) {
      throw runtimeError(
        "Agent SDK turn no longer accepts user input.",
        {
          runtimeCode:
            this.abortRequested
              ? "ABORTED"
              : "RUNTIME_UNAVAILABLE",
        },
      );
    }

    const normalizedText = nonblankString(text);
    if (!normalizedText) {
      throw new Error(
        "Mid-turn user message must be nonblank.",
      );
    }

    const commandUuid =
      nonblankString(uuid) ?? randomUUID();
    this.inputQueue.push(
      userMessage(normalizedText, commandUuid),
    );
    const receipt = {
      status: "queued",
      command_uuid: commandUuid,
    };
    this.events.emit(
      "mid-turn-input",
      receipt,
    );
    return receipt;
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
    this.inputQueue?.end();
    this.interruptReceipt = receipt;
    this.events.emit("interrupt", receipt);
    return receipt;
  }

  abort() {
    if (this.closed) return;
    this.abortRequested = true;
    this.inputQueue?.end();
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

        if (
          this.executionReadback
          && !this.executionReadbackSampled
          && message?.type === "assistant"
        ) {
          this.executionReadbackSampled = true;
          try {
            if (typeof this.query.getSettings === "function") {
              this.rawExecutionSettings =
                await this.query.getSettings();
            } else {
              throw new Error(
                "Claude Agent SDK Query does not expose getSettings().",
              );
            }

            if (typeof this.query.supportedModels === "function") {
              this.rawSupportedModels =
                await this.query.supportedModels();
            }
          } catch (cause) {
            this.executionReadbackError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }

        if (
          message?.type === "assistant"
          && typeof this.query.getContextUsage === "function"
        ) {
          try {
            this.rawContextUsage = await this.query.getContextUsage({
              detail: "summary",
            });
            this.contextUsageError = null;
          } catch (cause) {
            if (!this.rawContextUsage) {
              this.contextUsageError =
                cause instanceof Error ? cause.message : String(cause);
            }
          }
        }

        if (message?.type === "result") {
          terminalResult = message;
          this.inputQueue?.end();
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
      this.inputQueue?.end();
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
      rawContextUsage: this.rawContextUsage,
      contextUsageError: this.contextUsageError,
      rawExecutionSettings: this.rawExecutionSettings,
      rawSupportedModels: this.rawSupportedModels,
      executionReadbackError: this.executionReadbackError,
    };
  }
}
