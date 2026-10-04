import { EventEmitter } from "node:events";
import { ClaudeTransport } from "./claude-transport.mjs";
import { ClaudeEventNormalizer } from "./normalized-events.mjs";
import { createAgentSdkTurnHandle } from "./agent-sdk-turn-handle.mjs";
import { LEILEIOS_MIND_SYSTEM_PROMPT } from "./leileios-mind-system-prompt.mjs";
import { LEILEIOS_WAKE_SYSTEM_PROMPT } from "./leileios-wake-system-prompt.mjs";
import {
  normalizeAgentSdkExecutionSelection,
} from "./agent-sdk-execution-selection.mjs";
import {
  normalizeAgentSdkContextUsage,
} from "./agent-sdk-context-observability.mjs";
import {
  normalizeAgentSdkExecutionReadback,
} from "./agent-sdk-execution-readback.mjs";

function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

async function loadDefaultListSessions() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.listSessions !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose listSessions().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.listSessions;
}

async function loadDefaultSessionMessages() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.getSessionMessages !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose getSessionMessages().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.getSessionMessages;
}

async function loadDefaultImportSessionToStore() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.importSessionToStore !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose importSessionToStore().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.importSessionToStore;
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
      let durableEntries = null;
      if (
        options?.sessionStore
        && typeof options.sessionStore.load === "function"
      ) {
        durableEntries = await options.sessionStore.load({
          projectKey: options?.dir ?? "leileios",
          sessionId,
        });
      }
      if (
        messages.length === 0
        && (
          durableEntries === null
          || (
            Array.isArray(durableEntries)
            && durableEntries.length === 0
          )
        )
      ) {
        return;
      }
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

async function createDefaultSendFileMcpServer(
  sendFileHandler,
) {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { z } = await import("zod");
  if (
    typeof sdk.createSdkMcpServer !== "function"
    || typeof sdk.tool !== "function"
  ) {
    throw runtimeError(
      "Claude Agent SDK did not expose in-process MCP helpers.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  const sendFileTool = sdk.tool(
    "send_file",
    [
      "Send one specific local file from the active workspace to the user.",
      "Use this only when you explicitly intend to share or deliver that file.",
      "Never scan directories or infer files to send; pass the exact file path.",
    ].join(" "),
    {
      path: z.string().min(1),
      display_name: z.string().min(1).max(255).optional(),
    },
    async ({ path, display_name }) => {
      try {
        const attachment = await sendFileHandler({
          path,
          displayName: display_name ?? null,
        });
        return {
          content: [
            {
              type: "text",
              text:
                "Sent file to the user: "
                + attachment.filename,
            },
          ],
        };
      } catch (cause) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "send_file failed: "
                + (
                  cause instanceof Error
                    ? cause.message
                    : "unknown error"
                ),
            },
          ],
        };
      }
    },
  );

  return sdk.createSdkMcpServer({
    name: "leileios-local-send-file",
    version: "1.0.0",
    tools: [sendFileTool],
  });
}

async function createDefaultAlbumMcpServer(
  albumHandlers,
) {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { z } = await import("zod");
  if (
    typeof sdk.createSdkMcpServer !== "function"
    || typeof sdk.tool !== "function"
  ) {
    throw runtimeError(
      "Claude Agent SDK did not expose in-process MCP helpers.",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }

  const savePhotoTool = sdk.tool(
    "save_photo",
    [
      "Save one available user-owned image attachment into your private photo album.",
      "The attachment may come from the current turn or an earlier turn if it is still available.",
      "Use this when you genuinely want to keep a photo; do not save every image.",
      "Pass an exact attachment_id that LeileiOS previously exposed to you.",
      "why_saved must be your own reason for keeping it at the time you save it.",
    ].join(" "),
    {
      source_attachment_id: z.string().min(1),
      why_saved: z.string().min(1).max(4000),
      description: z.string().max(2000).optional(),
      tags: z.array(
        z.string().min(1).max(80),
      ).max(12).optional(),
    },
    async ({
      source_attachment_id,
      why_saved,
      description,
      tags,
    }) => {
      try {
        const result = await albumHandlers.savePhoto({
          sourceAttachmentId: source_attachment_id,
          description: description ?? null,
          whySaved: why_saved,
          tags: tags ?? [],
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              saved: result.created,
              photo: result.photo,
            }),
          }],
        };
      } catch (cause) {
        return {
          isError: true,
          content: [{
            type: "text",
            text:
              "save_photo failed: "
              + (
                cause instanceof Error
                  ? cause.message
                  : "unknown error"
              ),
          }],
        };
      }
    },
  );

  const searchPhotosTool = sdk.tool(
    "search_photos",
    [
      "Search your private photo album.",
      "Use this when you want to recall or choose a photo you previously saved.",
      "Omit query to browse the most recent photos, newest first.",
      "Search returns compact metadata only, never image bytes.",
    ].join(" "),
    {
      query: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
    async ({ query, limit }) => {
      try {
        const photos = await albumHandlers.searchPhotos({
          query: query ?? null,
          limit: limit ?? 10,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              photos: photos.map(projectAlbumSearchPhoto),
            }),
          }],
        };
      } catch (cause) {
        return {
          isError: true,
          content: [{
            type: "text",
            text:
              "search_photos failed: "
              + (
                cause instanceof Error
                  ? cause.message
                  : "unknown error"
              ),
          }],
        };
      }
    },
  );

  const viewPhotoTool = sdk.tool(
    "view_photo",
    [
      "Open one photo from your private album so you can visually inspect it again.",
      "Use a photo id from search_photos.",
      "This previews the image to you without sending it to the user.",
    ].join(" "),
    {
      photo_id: z.string().min(1),
    },
    async ({ photo_id }) => {
      try {
        const result = await albumHandlers.viewPhoto({
          photoId: photo_id,
        });
        return {
          content: [
            {
              type: "image",
              data: result.image.data,
              mimeType: result.image.mimeType,
            },
            {
              type: "text",
              text: JSON.stringify({
                photo: projectAlbumSearchPhoto(
                  result.photo,
                ),
              }),
            },
          ],
        };
      } catch (cause) {
        return {
          isError: true,
          content: [{
            type: "text",
            text:
              "view_photo failed: "
              + (
                cause instanceof Error
                  ? cause.message
                  : "unknown error"
              ),
          }],
        };
      }
    },
  );

  const sendPhotoTool = sdk.tool(
    "send_photo",
    [
      "Send one photo from your private album to the user.",
      "Choose a photo id from search_photos or from album metadata already in context.",
      "The image is delivered through LeileiOS attachments; do not encode image bytes in text.",
    ].join(" "),
    {
      photo_id: z.string().min(1),
    },
    async ({ photo_id }) => {
      try {
        const result = await albumHandlers.sendPhoto({
          photoId: photo_id,
        });
        return {
          content: [{
            type: "text",
            text:
              "Sent album photo to the user: "
              + result.photo.filename,
          }],
        };
      } catch (cause) {
        return {
          isError: true,
          content: [{
            type: "text",
            text:
              "send_photo failed: "
              + (
                cause instanceof Error
                  ? cause.message
                  : "unknown error"
              ),
          }],
        };
      }
    },
  );

  return sdk.createSdkMcpServer({
    name: "leileios-local-album",
    version: "1.0.0",
    tools: [
      savePhotoTool,
      searchPhotosTool,
      viewPhotoTool,
      sendPhotoTool,
    ],
  });
}

function projectAlbumSearchPhoto(photo) {
  return {
    id: photo.id,
    filename: photo.filename,
    mime_type: photo.mimeType,
    description: clippedAlbumText(photo.description, 600),
    why_saved: clippedAlbumText(photo.whySaved, 800),
    tags: Array.isArray(photo.tags)
      ? photo.tags.slice(0, 12)
      : [],
    created_at: photo.createdAt,
  };
}

function clippedAlbumText(value, maxLength) {
  if (typeof value !== "string") return null;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + "…";
}

function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isNativeClaudeScheduleCommand(value) {
  return typeof value === "string"
    && /^\/(?:schedule|routines)(?:\s|$)/iu.test(value);
}

function sdkResultFailed(message) {
  if (!message || message.type !== "result") return false;
  if (message.is_error === true) return true;
  return typeof message.subtype === "string" && message.subtype !== "success";
}

function sdkMirrorFailed(message) {
  return message?.subtype === "mirror_error";
}

function clippedSessionStoreReason(value) {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value == null
          ? null
          : String(value);
  if (!text || !text.trim()) return null;
  return text.length <= 2_000 ? text : text.slice(0, 2_000);
}

function sdkMirrorFailureReason(events) {
  if (!Array.isArray(events)) return null;
  const failure = [...events].reverse().find(sdkMirrorFailed);
  if (!failure) return null;
  return (
    clippedSessionStoreReason(failure.error)
    ?? clippedSessionStoreReason(failure.message)
    ?? clippedSessionStoreReason(failure.code)
    ?? "Claude Agent SDK reported SessionStore mirror_error."
  );
}

function sessionIdFromEvents(events) {
  if (!Array.isArray(events)) return null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const id =
      nonblankString(event?.session_id)
      ?? nonblankString(event?.sessionId);
    if (id) return id;
  }
  return null;
}

function sessionStoreHealthSnapshot({
  configured,
  mode,
  cwd,
  sessionId = null,
  parentSessionId = null,
  portability,
  completion,
  mirrorFailureReason = null,
}) {
  const statusAfter = completion?.statusAfter ?? null;
  const normalizedSessionId = nonblankString(sessionId);
  return {
    provider: "claude_agent_sdk",
    configured,
    mode,
    session_id: normalizedSessionId,
    parent_session_id: nonblankString(parentSessionId),
    project_key: cwd,
    cwd,
    parent_local_available:
      portability?.parentLocalAvailable ?? null,
    parent_status_before:
      portability?.parentStatusBefore ?? null,
    backfill_status:
      portability?.backfillStatus ?? "not_needed",
    backfill_failure_reason:
      portability?.backfillFailureReason ?? null,
    mirror_status:
      mirrorFailureReason
        ? "error"
        : configured && normalizedSessionId
          ? "ok"
          : "not_observed",
    mirror_failure_reason: mirrorFailureReason,
    status_after: statusAfter,
    status_failure_reason:
      completion?.statusFailureReason ?? null,
  };
}

function attachSessionStoreHealth(error, health) {
  if (error && typeof error === "object") {
    error.sessionStoreObservability = health;
    return error;
  }
  return runtimeError(String(error), {
    runtimeCode: "RUNTIME_UNAVAILABLE",
    sessionStoreObservability: health,
  });
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
function normalizeLeileiosMcpServerConfig(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "object"
    || value.type !== "http"
    || typeof value.url !== "string"
    || !value.url.trim()
    || !value.headers
    || typeof value.headers !== "object"
    || Array.isArray(value.headers)
  ) {
    throw new Error("LeileiOS MCP server config is invalid.");
  }
  return {
    type: "http",
    url: value.url.trim(),
    headers: Object.fromEntries(
      Object.entries(value.headers).map(([key, headerValue]) => {
        if (
          typeof headerValue !== "string"
          || !headerValue.trim()
        ) {
          throw new Error(
            "LeileiOS MCP server headers must be nonblank strings.",
          );
        }
        return [key, headerValue];
      }),
    ),
  };
}

function leileiosMcpQueryOptions(
  config,
  localSendFileServer = null,
  localAlbumServer = null,
) {
  if (
    !config
    && !localSendFileServer
    && !localAlbumServer
  ) return {};
  return {
    mcpServers: {
      ...(config ? { leileios: config } : {}),
      ...(localSendFileServer
        ? { leileios_local: localSendFileServer }
        : {}),
      ...(localAlbumServer
        ? { leileios_album: localAlbumServer }
        : {}),
    },
  };
}

export class AgentSdkClaudeTransport extends ClaudeTransport {
  constructor({
    queryImpl = null,
    loadQuery = loadDefaultQuery,
    deleteSessionImpl = null,
    loadDeleteSession = loadDefaultDeleteSession,
    listSessionsImpl = null,
    loadListSessions = loadDefaultListSessions,
    sessionMessagesImpl = null,
    loadSessionMessages = loadDefaultSessionMessages,
    importSessionToStoreImpl = null,
    loadImportSessionToStore = loadDefaultImportSessionToStore,
    sessionStore = null,
    mcpServerConfig = null,
    createSendFileMcpServerImpl =
      createDefaultSendFileMcpServer,
    createAlbumMcpServerImpl =
      createDefaultAlbumMcpServer,
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
    this.deleteSessionImpl = deleteSessionImpl;
    this.loadDeleteSession = loadDeleteSession;
    this.listSessionsImpl = listSessionsImpl;
    this.loadListSessions = loadListSessions;
    this.sessionMessagesImpl = sessionMessagesImpl;
    this.loadSessionMessages = loadSessionMessages;
    this.importSessionToStoreImpl = importSessionToStoreImpl;
    this.loadImportSessionToStore = loadImportSessionToStore;
    this.sessionStore = sessionStore;
    this.mcpServerConfig =
      normalizeLeileiosMcpServerConfig(mcpServerConfig);
    this.createSendFileMcpServerImpl =
      createSendFileMcpServerImpl;
    this.createAlbumMcpServerImpl =
      createAlbumMcpServerImpl;
    this.environment = {
      ...environment,
      DISABLE_AUTO_COMPACT: "1",
      CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
    };
    this.cwd = cwd;
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

  async resume(sessionId, prompt, execution = null) {
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
      userMessageUuid = null,
      execution = null,
      onNormalizedEvent = null,
      permissionHandler = null,
      questionHandler = null,
      trustedReadPaths = [],
      sendFileHandler = null,
      albumHandlers = null,
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
    let portability = {
      canComplete: true,
      parentLocalAvailable: null,
      parentStatusBefore: null,
      backfillStatus: "not_needed",
      backfillFailureReason: null,
    };
    if (mode !== "new") {
      try {
        portability = await this.#prepareSessionForTurn(
          parentProviderSessionId,
          mode,
        );
      } catch (cause) {
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(this.sessionStore),
            mode,
            cwd: this.cwd,
            parentSessionId: parentProviderSessionId,
            portability,
            completion: {
              statusAfter: null,
              statusFailureReason:
                clippedSessionStoreReason(cause),
            },
          }),
        );
      }
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
    const nativeScheduleCommand =
      isNativeClaudeScheduleCommand(prompt);
    const localSendFileServer =
      sendFileHandler
        ? await this.createSendFileMcpServerImpl(
            sendFileHandler,
          )
        : null;
    const localAlbumServer =
      albumHandlers
        ? await this.createAlbumMcpServerImpl(
            albumHandlers,
          )
        : null;

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
        verbatimPrompts: !nativeScheduleCommand,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: [LEILEIOS_MIND_SYSTEM_PROMPT, LEILEIOS_WAKE_SYSTEM_PROMPT].join("\n\n"),
        },
        ...executionOptions,
        ...leileiosMcpQueryOptions(
          this.mcpServerConfig,
          localSendFileServer,
          localAlbumServer,
        ),
        ...(this.sessionStore
          ? { sessionStore: this.sessionStore }
          : {}),
      },
      streaming,
      userMessageUuid,
      permissionHandler,
      questionHandler,
      trustedReadPaths,
      midTurnInput:
        Boolean(controlPump) && !nativeScheduleCommand,
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
              sendUserMessage: (text, options = {}) =>
                handle.sendUserMessage(text, options),
              interrupt: () => handle.interrupt(),
            },
            { signal: controlAbort.signal },
          ),
        ).catch((cause) => {
          controlPumpError ??= cause;
        });
      }

      let handleResult;
      try {
        handleResult = await completion;
      } catch (cause) {
        const events =
          Array.isArray(cause?.events) ? cause.events : [];
        const providerSessionId =
          nonblankString(cause?.providerSessionId)
          ?? sessionIdFromEvents(events);
        const mirrorFailureReason =
          sdkMirrorFailureReason(events);
        const completionState =
          await this.#completePortability(
            providerSessionId,
            false,
            mirrorFailureReason,
            mode === "resume" && portability.canComplete,
          );
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(this.sessionStore),
            mode,
            cwd: this.cwd,
            sessionId: providerSessionId,
            parentSessionId: parentProviderSessionId,
            portability,
            completion: completionState,
            mirrorFailureReason,
          }),
        );
      }
      const contextUsage =
        normalizeAgentSdkContextUsage(handleResult.rawContextUsage);
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
      const mirrorFailureReason =
        sdkMirrorFailureReason(result.events);
      const completionState =
        await this.#completePortability(
          result.providerSessionId,
          portability.canComplete,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      const sessionStoreObservability =
        sessionStoreHealthSnapshot({
          configured: Boolean(this.sessionStore),
          mode,
          cwd: this.cwd,
          sessionId: result.providerSessionId,
          parentSessionId: parentProviderSessionId,
          portability,
          completion: completionState,
          mirrorFailureReason,
        });
      this.events.emit("exit", {
        code: 0,
        signal: null,
      });
      return {
        ...result,
        contextUsage,
        contextUsageError,
        executionReadback,
        executionReadbackError,
        sessionStoreObservability,
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

  async listSessions({
    limit = 100,
    offset = 0,
  } = {}) {
    if (this.activeQuery || this.activeTurnHandle) {
      throw runtimeError(
        "Claude Agent SDK sessions cannot be listed during an active turn.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    const listSessions = await this.#resolveListSessions();
    let rows;
    try {
      rows = await listSessions({
        dir: this.cwd,
        limit,
        offset,
        includeWorktrees: false,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to list Claude Agent SDK sessions: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
    if (!Array.isArray(rows)) {
      throw runtimeError(
        "Claude Agent SDK listSessions() returned an invalid result.",
        { runtimeCode: "RUNTIME_UNAVAILABLE" },
      );
    }
    return rows
      .map((row) => ({
        sessionId: nonblankString(row?.sessionId),
        summary: nonblankString(row?.summary),
        customTitle: nonblankString(row?.customTitle),
        firstPrompt: nonblankString(row?.firstPrompt),
        gitBranch: nonblankString(row?.gitBranch),
        cwd: nonblankString(row?.cwd) ?? this.cwd,
        lastModified:
          Number.isFinite(row?.lastModified)
            ? row.lastModified
            : null,
        createdAt:
          Number.isFinite(row?.createdAt)
            ? row.createdAt
            : null,
      }))
      .filter((row) => row.sessionId);
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
      await deleteSessionImpl(id, {
        dir: this.cwd,
        ...(this.sessionStore
          ? { sessionStore: this.sessionStore }
          : {}),
      });
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

  async #requireSession(sessionId) {
    const id = nonblankString(sessionId);
    if (!id) {
      throw runtimeError(
        "Claude Agent SDK parent session id is required.",
        { runtimeCode: "NO_PROVIDER_SESSION" },
      );
    }

    const getSessionMessages = await this.#resolveSessionMessages();
    let messages;
    try {
      messages = await getSessionMessages(id, {
        dir: this.cwd,
        limit: 1,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect Claude Agent SDK parent session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }

    const localAvailable =
      Array.isArray(messages) && messages.length > 0;
    const status = await this.#readPortabilityStatus(id);

    if (localAvailable) {
      return {
        localAvailable: true,
        status,
      };
    }

    if (
      status !== "complete"
      || !this.sessionStore
      || typeof this.sessionStore.load !== "function"
    ) {
      throw runtimeError(
        "Claude Agent SDK parent session has no complete durable transcript.",
        {
          runtimeCode: "NO_PROVIDER_SESSION",
          parentSessionId: id,
        },
      );
    }

    let remote;
    try {
      remote = await this.sessionStore.load({
        projectKey: this.cwd,
        sessionId: id,
      });
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect durable Claude Agent SDK parent session: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
    if (!Array.isArray(remote) || remote.length === 0) {
      throw runtimeError(
        "Claude Agent SDK parent session has no complete durable transcript.",
        {
          runtimeCode: "NO_PROVIDER_SESSION",
          parentSessionId: id,
        },
      );
    }

    return {
      localAvailable: false,
      status,
    };
  }

  async #prepareSessionForTurn(sessionId, mode) {
    const id = nonblankString(sessionId);
    const preflight = await this.#requireSession(id);
    let status = preflight.status;
    let backfillStatus = "not_needed";
    let backfillFailureReason = null;

    if (
      preflight.localAvailable
      && status === null
    ) {
      const backfill = await this.#tryBackfillLocalSession(id);
      status = backfill.status;
      backfillStatus = backfill.backfillStatus;
      backfillFailureReason = backfill.failureReason;
    }

    const canComplete = status === "complete";

    if (mode === "resume" && canComplete) {
      if (
        !this.sessionStore
        || typeof this.sessionStore.markIncomplete !== "function"
      ) {
        throw runtimeError(
          "Durable Claude Agent SDK session cannot be marked incomplete before mutation.",
          { runtimeCode: "RUNTIME_UNAVAILABLE" },
        );
      }
      try {
        await this.sessionStore.markIncomplete(id);
      } catch (cause) {
        throw runtimeError(
          `Failed to mark durable Claude Agent SDK session incomplete: ${cause instanceof Error ? cause.message : String(cause)}`,
          { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
        );
      }
    }

    return {
      canComplete,
      parentLocalAvailable: preflight.localAvailable,
      parentStatusBefore: preflight.status,
      backfillStatus,
      backfillFailureReason,
    };
  }

  async #tryBackfillLocalSession(sessionId) {
    if (
      !this.sessionStore
      || typeof this.sessionStore.load !== "function"
      || typeof this.sessionStore.markComplete !== "function"
    ) {
      return {
        status: null,
        backfillStatus: "unavailable",
        failureReason:
          "Durable SessionStore backfill helpers are unavailable.",
      };
    }

    let importSessionToStore;
    try {
      importSessionToStore =
        this.importSessionToStoreImpl
        ?? await this.loadImportSessionToStore();
    } catch (cause) {
      this.events.emit("session-store-backfill-error", cause);
      return {
        status: null,
        backfillStatus: "unavailable",
        failureReason: clippedSessionStoreReason(cause),
      };
    }

    try {
      await importSessionToStore(
        sessionId,
        this.sessionStore,
        {
          dir: this.cwd,
          includeSubagents: true,
          batchSize: 500,
        },
      );
      const entries = await this.sessionStore.load({
        projectKey: this.cwd,
        sessionId,
      });
      if (!Array.isArray(entries) || entries.length === 0) {
        const cause = new Error(
          "SessionStore backfill produced no readable transcript.",
        );
        this.events.emit("session-store-backfill-error", cause);
        return {
          status: null,
          backfillStatus: "failed",
          failureReason: cause.message,
        };
      }
      await this.sessionStore.markComplete(sessionId);
      return {
        status: "complete",
        backfillStatus: "complete",
        failureReason: null,
      };
    } catch (cause) {
      this.events.emit("session-store-backfill-error", cause);
      return {
        status: null,
        backfillStatus: "failed",
        failureReason: clippedSessionStoreReason(cause),
      };
    }
  }

  async #readPortabilityStatus(sessionId) {
    if (
      !this.sessionStore
      || typeof this.sessionStore.getStatus !== "function"
    ) {
      return null;
    }
    try {
      const status = await this.sessionStore.getStatus(sessionId);
      if (
        status !== null
        && status !== "complete"
        && status !== "incomplete"
      ) {
        throw new Error("SessionStore returned an invalid portability status.");
      }
      return status;
    } catch (cause) {
      throw runtimeError(
        `Failed to inspect durable Claude Agent SDK session status: ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #completePortability(
    sessionId,
    canComplete,
    mirrorFailureReason,
    alreadyIncomplete = false,
  ) {
    const id = nonblankString(sessionId);
    if (!id || !this.sessionStore) {
      return {
        statusAfter: null,
        statusFailureReason: null,
      };
    }

    let statusAfter = null;
    let statusFailureReason = null;

    if (mirrorFailureReason) {
      if (
        typeof this.sessionStore.discardPendingAppends === "function"
      ) {
        this.sessionStore.discardPendingAppends(id);
      }

      if (alreadyIncomplete) {
        statusAfter = "incomplete";
      } else if (
        typeof this.sessionStore.markIncomplete === "function"
      ) {
        try {
          await this.sessionStore.markIncomplete(id);
          statusAfter = "incomplete";
        } catch (cause) {
          statusFailureReason =
            clippedSessionStoreReason(cause);
          this.events.emit("session-store-status-error", cause);
        }
      } else {
        statusFailureReason =
          "SessionStore markIncomplete() is unavailable.";
      }
    } else if (
      canComplete
      && typeof this.sessionStore.load === "function"
      && typeof this.sessionStore.markComplete === "function"
    ) {
      try {
        const entries = await this.sessionStore.load({
          projectKey: this.cwd,
          sessionId: id,
        });
        if (Array.isArray(entries) && entries.length > 0) {
          await this.sessionStore.markComplete(id);
          statusAfter = "complete";
        }
      } catch (cause) {
        statusFailureReason =
          clippedSessionStoreReason(cause);
        this.events.emit("session-store-status-error", cause);
      }
    }

    if (
      statusAfter === null
      && statusFailureReason === null
      && typeof this.sessionStore.getStatus === "function"
    ) {
      try {
        const observed =
          await this.sessionStore.getStatus(id);
        if (
          observed === null
          || observed === "complete"
          || observed === "incomplete"
        ) {
          statusAfter = observed;
        } else {
          throw new Error(
            "SessionStore returned an invalid portability status.",
          );
        }
      } catch (cause) {
        statusFailureReason ??=
          clippedSessionStoreReason(cause);
        this.events.emit("session-store-status-error", cause);
      }
    }

    return {
      statusAfter,
      statusFailureReason,
    };
  }

  async #resolveListSessions() {
    if (this.listSessionsImpl) return this.listSessionsImpl;
    try {
      this.listSessionsImpl = await this.loadListSessions();
      return this.listSessionsImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK listSessions(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
  }

  async #resolveSessionMessages() {
    if (this.sessionMessagesImpl) return this.sessionMessagesImpl;
    try {
      this.sessionMessagesImpl = await this.loadSessionMessages();
      return this.sessionMessagesImpl;
    } catch (cause) {
      throw runtimeError(
        `Failed to load Claude Agent SDK getSessionMessages(): ${cause instanceof Error ? cause.message : String(cause)}`,
        { runtimeCode: "RUNTIME_UNAVAILABLE", cause },
      );
    }
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

    let portability = {
      canComplete: true,
      parentLocalAvailable: null,
      parentStatusBefore: null,
      backfillStatus: "not_needed",
      backfillFailureReason: null,
    };
    if (mode !== "new") {
      try {
        portability = await this.#prepareSessionForTurn(
          parentProviderSessionId,
          mode,
        );
      } catch (cause) {
        throw attachSessionStoreHealth(
          cause,
          sessionStoreHealthSnapshot({
            configured: Boolean(this.sessionStore),
            mode,
            cwd: this.cwd,
            parentSessionId: parentProviderSessionId,
            portability,
            completion: {
              statusAfter: null,
              statusFailureReason:
                clippedSessionStoreReason(cause),
            },
          }),
        );
      }
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
      ...leileiosMcpQueryOptions(this.mcpServerConfig),
      ...(resume ? { resume } : {}),
      ...(forkSession ? { forkSession: true } : {}),
      ...(this.sessionStore
        ? { sessionStore: this.sessionStore }
        : {}),
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
    let mirrorFailureReason = null;

    try {
      for await (const message of activeQuery) {
        parsedEvents.push(message);
        if (sdkMirrorFailed(message)) {
          mirrorFailureReason =
            sdkMirrorFailureReason([message])
            ?? mirrorFailureReason;
        }
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
          && (
            message?.type === "assistant"
            || (
              message?.type === "system"
              && message?.subtype === "compact_boundary"
            )
          )
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

      if (
        captureContextUsage
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
    } catch (cause) {
      const completionState =
        await this.#completePortability(
          providerSessionId,
          false,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      const health = sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });
      if (this.abortRequested) {
        throw runtimeError(
          "Claude Agent SDK turn was aborted.",
          {
            runtimeCode: "ABORTED",
            cause,
            events: parsedEvents,
            normalizedEvents,
            sessionStoreObservability: health,
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
          sessionStoreObservability: health,
        },
      );
    } finally {
      if (this.activeQuery === activeQuery) {
        this.activeQuery = null;
      }
    }

    if (this.abortRequested || terminalFailure) {
      const completionState =
        await this.#completePortability(
          providerSessionId,
          false,
          mirrorFailureReason,
          mode === "resume" && portability.canComplete,
        );
      const health = sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });
      if (this.abortRequested) {
        throw runtimeError(
          "Claude Agent SDK turn was aborted.",
          {
            runtimeCode: "ABORTED",
            events: parsedEvents,
            normalizedEvents,
            sessionStoreObservability: health,
          },
        );
      }
      throw runtimeError(
        sdkFailureMessage(terminalFailure),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          result: terminalFailure,
          events: parsedEvents,
          normalizedEvents,
          sessionStoreObservability: health,
        },
      );
    }

    const completionState =
      await this.#completePortability(
        providerSessionId,
        portability.canComplete,
        mirrorFailureReason,
        mode === "resume" && portability.canComplete,
      );
    const sessionStoreObservability =
      sessionStoreHealthSnapshot({
        configured: Boolean(this.sessionStore),
        mode,
        cwd: this.cwd,
        sessionId: providerSessionId,
        parentSessionId: parentProviderSessionId,
        portability,
        completion: completionState,
        mirrorFailureReason,
      });

    this.events.emit("exit", {
      code: 0,
      signal: null,
    });

    const contextUsage =
      normalizeAgentSdkContextUsage(rawContextUsage);
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
      executionReadback,
      executionReadbackError,
      sessionStoreObservability,
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
    };
  }
}
