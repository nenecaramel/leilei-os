import { EventEmitter } from "node:events";
import { ClaudeTransport } from "./claude-transport.mjs";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";
import { createAgentSdkTurnHandle } from "./agent-sdk-turn-handle.mjs";
import {
  normalizeAgentSdkExecutionSelection,
} from "./agent-sdk-execution-selection.mjs";
import {
  evaluateTurnBoundaryCompaction,
  normalizeAgentSdkContextUsage,
} from "./agent-sdk-context-observability.mjs";
import {
  normalizeAgentSdkExecutionReadback,
} from "./agent-sdk-execution-readback.mjs";

function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

async function loadDefaultDeleteSession() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (
    typeof sdk.deleteSession !== "function"
    || typeof sdk.getSessionMessages !== "function"
  ) {
    throw runtimeError(
      "Claude Agent SDK did not expose session deletion helpers.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  return async (sessionId, options) => {
    try {
      await sdk.deleteSession(sessionId, options);
    } catch (cause) {
      // A durable cleanup acknowledgement may be lost after the local hard
      // delete succeeds. Retrying the reservation must therefore treat an
      // already-absent transcript as success.
      const messages = await sdk.getSessionMessages(sessionId, {
        ...(options?.dir ? { dir: options.dir } : {}),
        limit: 1,
      });
      if (messages.length === 0) return;
      throw cause;
    }
  };
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
    deleteSessionImpl = null,
    loadDeleteSession = loadDefaultDeleteSession,
    environment = process.env,
    cwd = process.cwd(),
    compactionThresholdPercent = 75,
  } = {}) {
    super();
    if (environment.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY must be unset; native live uses Claude subscription auth.",
      );
    }
    this.queryImpl = queryImpl;
    this.loadQuery = loadQuery;
    this.deleteSessionImpl = deleteSessionImpl;
    this.loadDeleteSession = loadDeleteSession;
    this.environment = environment;
    this.cwd = cwd;
    this.compactionThresholdPercent = compactionThresholdPercent;
    this.events = new EventEmitter();
    this.activeQuery = null;
    this.activeTurnHandle = null;
    this.abortRequested = false;
  }

  sendNew(prompt, execution = null) {
    return this.#run(prompt, {
      mode: "new",
      execution,
    });
  }

  resume(sessionId, prompt, execution = null) {
    return this.#run(prompt, {
      mode: "resume",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      execution,
    });
  }

  async fork(sessionId, prompt, execution = null) {
    const result = await this.#run(prompt, {
      mode: "fork",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      forkSession: true,
      execution,
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

  async executeTurn(
    prompt,
    {
      mode = "new",
      parentProviderSessionId = null,
      streaming = true,
      execution = null,
      onNormalizedEvent = null,
      permissionHandler = null,
      questionHandler = null,
      controlPump = null,
    } = {},
  ) {
    if (this.activeQuery || this.activeTurnHandle) {
      throw runtimeError(
        "Claude Agent SDK transport already has an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    if (
      mode !== "new"
      && mode !== "resume"
      && mode !== "fork"
    ) {
      throw new Error(
        "Agent SDK interactive turn mode must be new, resume, or fork.",
      );
    }
    if (
      mode === "new"
      && parentProviderSessionId !== null
    ) {
      throw new Error(
        "New Agent SDK interactive turn must not include a parent provider session.",
      );
    }
    if (
      mode !== "new"
      && !nonblankString(parentProviderSessionId)
    ) {
      throw new Error(
        "Resume/fork Agent SDK interactive turn requires a parent provider session.",
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

    const executionOptions =
      normalizeAgentSdkExecutionSelection(execution);

    const handle = await createAgentSdkTurnHandle({
      prompt,
      mode,
      parentProviderSessionId,
      resume:
        mode === "new"
          ? null
          : parentProviderSessionId,
      forkSession: mode === "fork",
      queryImpl,
      environment: this.environment,
      cwd: this.cwd,
      queryOptions: {
        verbatimPrompts: true,
        ...executionOptions,
      },
      streaming,
      permissionHandler,
      questionHandler,
      midTurnInput: Boolean(controlPump),
      executionReadback: Boolean(execution),
    });

    this.activeTurnHandle = handle;
    const forwardRaw = (event) => {
      this.events.emit("event", event);
    };
    let eventDelivery = Promise.resolve();
    let eventDeliveryError = null;
    const forwardNormalized = (event) => {
      this.events.emit("normalized-event", event);
      if (onNormalizedEvent) {
        eventDelivery = eventDelivery
          .then(() => onNormalizedEvent(event))
          .catch((cause) => {
            eventDeliveryError ??= cause;
          });
      }
    };
    handle.events.on("event", forwardRaw);
    handle.events.on(
      "normalized-event",
      forwardNormalized,
    );

    const controlAbort = new AbortController();
    let controlPumpError = null;
    let controlPumpPromise = Promise.resolve();

    try {
      const completion = handle.start();
      if (controlPump) {
        controlPumpPromise = Promise.resolve(
          controlPump(
            {
              sendUserMessage: (text) =>
                handle.sendUserMessage(text),
              interrupt: () => handle.interrupt(),
            },
            { signal: controlAbort.signal },
          ),
        ).catch((cause) => {
          controlPumpError ??= cause;
        });
      }

      const handleResult = await completion;
      const contextUsage =
        normalizeAgentSdkContextUsage(handleResult.rawContextUsage);
      const compactionAdvisory =
        evaluateTurnBoundaryCompaction(handleResult.rawContextUsage, {
          thresholdPercent: this.compactionThresholdPercent,
        });
      const executionReadback =
        execution
          ? normalizeAgentSdkExecutionReadback({
              requested: execution,
              settings: handleResult.rawExecutionSettings,
              supportedModels: handleResult.rawSupportedModels,
            })
          : null;
      const {
        rawContextUsage: _rawContextUsage,
        contextUsageError,
        rawExecutionSettings: _rawExecutionSettings,
        rawSupportedModels: _rawSupportedModels,
        executionReadbackError,
        ...result
      } = handleResult;

      if (!result.providerSessionId) {
        throw runtimeError(
          "Claude Agent SDK interactive turn returned no provider session id.",
          {
            runtimeCode: "NO_PROVIDER_SESSION",
            ...result,
          },
        );
      }
      if (
        mode === "fork"
        && result.providerSessionId === parentProviderSessionId
      ) {
        throw runtimeError(
          "Claude Agent SDK fork returned the same provider session id as its parent.",
          {
            runtimeCode: "PROVIDER_SESSION_CONFLICT",
            parentSessionId: parentProviderSessionId,
            forkSessionId: result.providerSessionId,
            ...result,
          },
        );
      }
      this.events.emit("exit", {
        code: 0,
        signal: null,
      });
      return {
        ...result,
        contextUsage,
        contextUsageError,
        compactionAdvisory,
        executionReadback,
        executionReadbackError,
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
      };
    } finally {
      controlAbort.abort();
      await controlPumpPromise;
      await eventDelivery;
      if (controlPumpError) {
        this.events.emit(
          "control-pump-error",
          controlPumpError,
        );
      }
      if (eventDeliveryError) {
        this.events.emit(
          "event-delivery-error",
          eventDeliveryError,
        );
      }
      handle.events.off("event", forwardRaw);
      handle.events.off(
        "normalized-event",
        forwardNormalized,
      );
      if (this.activeTurnHandle === handle) {
        this.activeTurnHandle = null;
      }
    }
  }

  async compact(sessionId, execution = null) {
    const lifecycle = {
      preCompact: [],
      postCompact: [],
    };
    const hooks = {
      PreCompact: [
        {
          hooks: [
            async (input) => {
              lifecycle.preCompact.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                customInstructions:
                  typeof input?.custom_instructions === "string"
                    ? input.custom_instructions
                    : null,
              });
              return {};
            },
          ],
        },
      ],
      PostCompact: [
        {
          hooks: [
            async (input) => {
              lifecycle.postCompact.push({
                hookEventName: input?.hook_event_name ?? null,
                trigger: input?.trigger ?? null,
                summary:
                  typeof input?.compact_summary === "string"
                    ? input.compact_summary
                    : null,
              });
              return {};
            },
          ],
        },
      ],
    };

    const result = await this.#run("/compact", {
      mode: "resume",
      parentProviderSessionId: sessionId,
      resume: sessionId,
      execution,
      verbatimPrompts: false,
      captureContextUsage: true,
      hooks,
    });

    if (result.providerSessionId !== sessionId) {
      throw runtimeError(
        "Claude Agent SDK compact changed provider session identity.",
        {
          runtimeCode: "PROVIDER_SESSION_CONFLICT",
          parentSessionId: sessionId,
          compactSessionId: result.providerSessionId,
          ...result,
        },
      );
    }

    const boundary =
      [...result.normalizedEvents]
        .reverse()
        .find((event) => event.type === "compaction")
        ?.payload ?? null;
    if (!boundary) {
      throw runtimeError(
        "Claude Agent SDK compact completed without a compact boundary.",
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          ...result,
        },
      );
    }

    return {
      ...result,
      compaction: {
        boundary,
        preCompact: lifecycle.preCompact,
        postCompact: lifecycle.postCompact,
      },
    };
  }

  async deleteSession(sessionId) {
    if (this.activeQuery || this.activeTurnHandle) {
      throw runtimeError(
        "Claude Agent SDK session cannot be deleted during an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    const id = nonblankString(sessionId);
    if (!id) {
      throw runtimeError(
        "Claude Agent SDK session id is required for deletion.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }

    const deleteSessionImpl = await this.#resolveDeleteSession();
    try {
      await deleteSessionImpl(id, { dir: this.cwd });
    } catch (cause) {
      throw runtimeError(
        `Failed to delete Claude Agent SDK session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  abort() {
    this.abortRequested = true;
    this.activeTurnHandle?.abort?.();
    this.activeQuery?.close?.();
  }

  async #resolveDeleteSession() {
    if (this.deleteSessionImpl) return this.deleteSessionImpl;
    try {
      this.deleteSessionImpl = await this.loadDeleteSession();
      return this.deleteSessionImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK deleteSession(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
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
      execution = null,
      verbatimPrompts = true,
      captureContextUsage = true,
      hooks = null,
    } = {},
  ) {
    if (this.activeQuery || this.activeTurnHandle) {
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

    const executionOptions =
      normalizeAgentSdkExecutionSelection(execution);

    const options = {
      cwd: this.cwd,
      env: this.environment,
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      verbatimPrompts,
      ...executionOptions,
      ...(resume ? { resume } : {}),
      ...(forkSession ? { forkSession: true } : {}),
      ...(hooks ? { hooks } : {}),
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
    let rawContextUsage = null;
    let contextUsageError = null;
    let rawExecutionSettings = null;
    let rawSupportedModels = null;
    let executionReadbackError = null;
    let executionReadbackSampled = false;

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

        if (
          execution
          && !executionReadbackSampled
          && message?.type === "assistant"
        ) {
          executionReadbackSampled = true;
          try {
            if (typeof activeQuery.getSettings === "function") {
              rawExecutionSettings = await activeQuery.getSettings();
            } else {
              throw new Error(
                "Claude Agent SDK Query does not expose getSettings().",
              );
            }

            if (typeof activeQuery.supportedModels === "function") {
              rawSupportedModels =
                await activeQuery.supportedModels();
            }
          } catch (cause) {
            executionReadbackError =
              cause instanceof Error ? cause.message : String(cause);
          }
        }

        if (
          captureContextUsage
          && message?.type === "assistant"
          && typeof activeQuery.getContextUsage === "function"
        ) {
          try {
            rawContextUsage = await activeQuery.getContextUsage({
              detail: "summary",
            });
            contextUsageError = null;
          } catch (cause) {
            if (!rawContextUsage) {
              contextUsageError =
                cause instanceof Error ? cause.message : String(cause);
            }
          }
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

    const contextUsage =
      normalizeAgentSdkContextUsage(rawContextUsage);
    const compactionAdvisory =
      evaluateTurnBoundaryCompaction(rawContextUsage, {
        thresholdPercent: this.compactionThresholdPercent,
      });
    const executionReadback =
      execution
        ? normalizeAgentSdkExecutionReadback({
            requested: execution,
            settings: rawExecutionSettings,
            supportedModels: rawSupportedModels,
          })
        : null;

    return {
      providerSessionId,
      events: parsedEvents,
      normalizedEvents,
      contextUsage,
      contextUsageError,
      compactionAdvisory,
      executionReadback,
      executionReadbackError,
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  }
}
