import { isNativeSessionMirror } from "./native-session-mirror.mjs";
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
  resumeSessionAt = null,
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
  requireSameSessionBeforePrompt = false,
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
  if (requireSameSessionBeforePrompt !== false && requireSameSessionBeforePrompt !== true) {
    throw new Error("Native resume identity guard must be boolean.");
  }
  if (requireSameSessionBeforePrompt && (mode !== "resume" || forkSession ||
      !nonblankString(resumeSessionAt) || !nonblankString(resume) || resume !== parentProviderSessionId ||
      (queryOptions.sessionStore && !isNativeSessionMirror(queryOptions.sessionStore, resume)) ||
      queryOptions.persistSession === false || queryOptions.verbatimPrompts === false)) {
    throw new Error("Native resume requires an exact same-session checkpoint without a materializing SessionStore.");
  }
  let settleNativeIdentity;
  const nativeIdentity = requireSameSessionBeforePrompt
    ? new Promise(resolve => { settleNativeIdentity = resolve; }) : null;

  let rejectNativeStartup;
  const nativeStartupFailure = requireSameSessionBeforePrompt
    ? new Promise(resolve => { rejectNativeStartup = resolve; })
    : new Promise(() => {});
  const nativeSessionStart = async input => {
    const sessionId = nonblankString(input?.session_id);
    if (input?.hook_event_name !== "SessionStart" || sessionId !== parentProviderSessionId) {
      const error = runtimeError("Native resume startup did not retain the original provider session.", {
        runtimeCode: "PROVIDER_SESSION_CONFLICT",
      });
      settleNativeIdentity(false);
      rejectNativeStartup(error);
      return { continue: false, stopReason: error.message };
    }
    // SessionStart runs during resume initialization. The stream's system/init
    // is emitted per turn, after input; waiting for it here deadlocks the SDK.
    settleNativeIdentity(true);
    return {};
  };

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

  const requiresMcpReadiness = Boolean(queryOptions.mcpServers?.leileios);
  let settleMcpReadiness;
  const mcpReadiness = requiresMcpReadiness
    ? new Promise((resolve) => { settleMcpReadiness = resolve; })
    : null;

  async function* readyPromptStream() {
    // SDK query() starts reading input immediately, before output iteration.
    // A false outcome ends that read cleanly without releasing the user message.
    if (!(await mcpReadiness)) return;
    if (nativeIdentity && !(await nativeIdentity)) return;
    yield* (inputQueue ?? promptStream());
  }

  async function* nativePromptStream() {
    if (!(await nativeIdentity)) return;
    yield* (inputQueue ?? promptStream());
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
    ...(requireSameSessionBeforePrompt
      ? { hooks: {
          ...queryOptions.hooks,
          SessionStart: [
            { hooks: [nativeSessionStart] },
            ...(queryOptions.hooks?.SessionStart ?? []),
          ],
        } }
      : {}),
    ...(resume ? { resume } : {}),
    ...(forkSession ? { forkSession: true } : {}),
    ...(resumeSessionAt ? { resumeSessionAt } : {}),
  };

  let query;
  try {
    query = resolvedQuery({
      prompt: requiresMcpReadiness
        ? readyPromptStream()
        : nativeIdentity
          ? nativePromptStream()
          : inputQueue
        ?? (
          queryOptions.verbatimPrompts === false
            ? prompt
            : promptStream()
        ),
      options,
    });
  } catch (cause) {
    settleNativeIdentity?.(false);
    settleMcpReadiness?.(false);
    inputQueue?.end();
    throw runtimeError(
      `Failed to start Claude Agent SDK turn: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
    );
  }

  if (!query || typeof query[Symbol.asyncIterator] !== "function") {
    settleNativeIdentity?.(false);
    settleMcpReadiness?.(false);
    inputQueue?.end();
    try {
      await query?.close?.();
    } catch {
      // Invalid queries still need best-effort cleanup.
    }
    throw runtimeError(
      "Claude Agent SDK query() did not return an async iterable.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  if (requiresMcpReadiness) {
    try {
      await waitForAgentSdkMcpServer(
        query,
        "leileios",
        { timeoutMs: mcpStartupTimeoutMs },
      );
    } catch (cause) {
      settleNativeIdentity?.(false);
      settleMcpReadiness(false);
      inputQueue?.end();
      try {
        await query.close?.();
      } catch {
        // Preserve the MCP startup failure; close is best-effort cleanup.
      }
      throw cause;
    }
  }

  settleMcpReadiness?.(true);
  return new AgentSdkTurnHandle({
    query,
    mode,
    parentProviderSessionId,
    events,
    inputQueue,
    midTurnInput,
    executionReadback,
    settleNativeIdentity,
    nativeStartupTimeoutMs: mcpStartupTimeoutMs,
    nativeStartupFailure,
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
    settleNativeIdentity = null,
    nativeStartupTimeoutMs = 120_000,
    nativeStartupFailure = new Promise(() => {}),
  }) {
    this.settleNativeIdentity = settleNativeIdentity;
    this.nativeIdentityConfirmed = false;
    this.nativeStartupTimeoutMs = nativeStartupTimeoutMs;
    this.nativeStartupFailure = nativeStartupFailure;
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
    this.interruptSignal = new Promise((resolve) => {
      this.resolveInterruptSignal = resolve;
    });
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
    this.resolveInterruptSignal?.();
    this.resolveInterruptSignal = null;
    try {
      Promise.resolve(this.query.close?.()).catch(() => undefined);
    } catch {
      // Provider already accepted the interrupt. Local close is best-effort.
    }
    return receipt;
  }

  abort() {
    if (this.closed) return;
    this.settleNativeIdentity?.(false);
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
    let nativeStartupTimer;
    const nativeStartupDeadline = this.settleNativeIdentity
      ? new Promise(resolve => { nativeStartupTimer = setTimeout(() => resolve({ kind: "native_startup_timeout" }), this.nativeStartupTimeoutMs); })
      : new Promise(() => {});

    const nativeStartupFailure = this.nativeStartupFailure.then(error => ({ kind: "native_startup_failure", error }));

    try {
      const iterator = this.query[Symbol.asyncIterator]();
      while (true) {
        const step = await Promise.race([
          iterator.next().then((value) => ({
            kind: "message",
            value,
          })),
          this.interruptSignal.then(() => ({
            kind: "interrupt",
          })),
          nativeStartupDeadline,
          ...(this.settleNativeIdentity && !this.nativeIdentityConfirmed
            ? [nativeStartupFailure] : []),
        ]);
        if (step.kind === "native_startup_failure") throw step.error;
        if (step.kind === "native_startup_timeout") {
          throw runtimeError("Native resume init did not confirm the original session before startup deadline.", { runtimeCode: "RUNTIME_UNAVAILABLE" });
        }
        if (step.kind === "interrupt") {
          break;
        }
        if (step.value.done) {
          break;
        }
        const message = step.value.value;
        if (this.settleNativeIdentity) {
          const sessionId = nonblankString(message?.session_id) ?? nonblankString(message?.sessionId);
          if (sessionId && sessionId !== this.parentProviderSessionId) {
            throw runtimeError("Native resume started a different provider session before prompt delivery.", {
              runtimeCode: "PROVIDER_SESSION_CONFLICT",
            });
          }
          if (message?.type === "system" && message?.subtype === "init") {
            if (!sessionId) throw runtimeError("Native resume init has no session identity.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
            clearTimeout(nativeStartupTimer);
            this.nativeIdentityConfirmed = true;
            this.settleNativeIdentity(true);
          } else if (!this.nativeIdentityConfirmed && message?.type !== "system") {
            throw runtimeError("Native resume has no verified init before execution.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
          }
        }
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
      if (this.settleNativeIdentity && !this.nativeIdentityConfirmed) {
        throw runtimeError("Native resume ended before confirming session identity.", { runtimeCode: "PROVIDER_SESSION_CONFLICT" });
      }
    } catch (cause) {
      if (this.settleNativeIdentity && ["PROVIDER_SESSION_CONFLICT", "RUNTIME_UNAVAILABLE"].includes(cause?.runtimeCode)) {
        this.settleNativeIdentity(false);
        try { await this.query.close?.(); } catch { /* Preserve identity refusal. */ }
        throw cause;
      }
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
      if (
        terminalResult?.subtype === "success"
        && terminalResult.is_error !== true
        && !terminalFailure
      ) {
        // The SDK can surface a terminal success result before its child
        // process finishes tearing down. A later non-zero process exit must
        // not erase that already-authoritative result; downstream transport
        // logic still enforces SessionStore/checkpoint durability.
      } else {
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
      }
    } finally {
      clearTimeout(nativeStartupTimer);
      this.settleNativeIdentity?.(false);
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
