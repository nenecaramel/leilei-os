import { join } from "node:path";
import { LEILEIOS_WAKE_SYSTEM_PROMPT } from "./leileios-wake-system-prompt.mjs";
import { LEILEIOS_MURMUR_SYSTEM_PROMPT } from "./leileios-murmur-system-prompt.mjs";

// A custom string replaces the Claude Code preset; only LeileiOS guidance is sent.
export const LEILEIOS_INTERACTIVE_SYSTEM_PROMPT = [LEILEIOS_WAKE_SYSTEM_PROMPT, LEILEIOS_MURMUR_SYSTEM_PROMPT].join("\n\n");

export function runtimeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

export async function loadDefaultListSessions() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.listSessions !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose listSessions().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.listSessions;
}

export async function loadDefaultSessionMessages() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.getSessionMessages !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose getSessionMessages().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.getSessionMessages;
}

export async function loadDefaultImportSessionToStore() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.importSessionToStore !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose importSessionToStore().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.importSessionToStore;
}

export async function loadDefaultDeleteSession() {
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

export async function loadDefaultQuery() {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.query !== "function") {
    throw runtimeError(
      "Claude Agent SDK did not expose query().",
      { runtimeCode: "RUNTIME_UNAVAILABLE" },
    );
  }
  return sdk.query;
}

export async function createDefaultSendFileMcpServer(
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
      "Send one specific local file from the active working directory to the user.",
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

export function nonblankString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

// Only a backend-confirmed failed input (or this exact re-delivery input)
// may explain generated residue. An SDK-owned closing interruption marker,
// bound to the same prompt ID, proves the tail is not a new Desktop turn.
export function sdkInterruptedTailStart(entries, approvedInputs, sessionId) {
  const end = entries.at(-1);
  const content = end?.message?.content;
  const text = typeof content === "string" ? content
    : Array.isArray(content) && content.length === 1 && content[0]?.type === "text"
      ? content[0].text : null;
  if (end?.type !== "user" || ![
    "[Request interrupted by user]",
    "[Request interrupted by user for tool use]",
  ].includes(text) || !nonblankString(end.promptId)) return null;
  const start = entries.findLastIndex(entry => entry.type === "user"
    && approvedInputs.has(entry.uuid) && entry.promptId === end.promptId);
  if (start < 0 || start === entries.length - 1) return null;
  for (const [index, entry] of entries.slice(start).entries()) {
    if (entry.entrypoint !== "sdk-ts" || entry.sessionId !== sessionId) return null;
    if (entry.type === "user") {
      if (entry.promptId !== end.promptId) return null;
      if (index > 0 && entry !== end && !(Array.isArray(entry.message?.content)
        && entry.message.content.length > 0
        && entry.message.content.every(block => block?.type === "tool_result"))) return null;
    } else if (!["assistant", "attachment"].includes(entry.type)) return null;
  }
  return start;
}

export function isNativeClaudeScheduleCommand(value) {
  return typeof value === "string"
    && /^\/(?:schedule|routines)(?:\s|$)/iu.test(value);
}

export function sdkResultFailed(message) {
  if (!message || message.type !== "result") return false;
  if (message.is_error === true) return true;
  return typeof message.subtype === "string" && message.subtype !== "success";
}

export function sdkMirrorFailed(message) {
  return message?.subtype === "mirror_error";
}

export function clippedSessionStoreReason(value) {
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

export function sdkMirrorFailureReason(events) {
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

export function sessionIdFromEvents(events) {
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

export function sessionStoreHealthSnapshot({
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

export function attachSessionStoreHealth(error, health) {
  if (error && typeof error === "object") {
    error.sessionStoreObservability = health;
    return error;
  }
  return runtimeError(String(error), {
    runtimeCode: "RUNTIME_UNAVAILABLE",
    sessionStoreObservability: health,
  });
}

export function sdkFailureMessage(message) {
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
export function normalizeLeileiosMcpServerConfig(value) {
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

export function leileiosMcpQueryOptions(
  config,
  localSendFileServer = null,
) {
  if (
    !config
    && !localSendFileServer
  ) return {};
  return {
    mcpServers: {
      ...(config ? { leileios: config } : {}),
      ...(localSendFileServer
        ? { leileios_local: localSendFileServer }
        : {}),
    },
  };
}
