import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import {
  DEFAULT_NATIVE_LIVE_CURRENT_PATH_LIMIT,
  MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT,
  nativeLiveCurrentPathEtag,
} from "../../domains/conversation/native-live-current-path-read-repository.js";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  requireWebUser,
  routeParam,
  UUID_PATTERN,
  exactBody,
} from "./http.js";

export function listNativeLiveConversationsHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const limit = parseConversationListLimit(request.query.limit);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_LIMIT",
          message:
            `Conversation list limit must be an integer from 1 to ${MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT}.`,
        },
      });
      return;
    }

    const scope = parseConversationListScope(request.query.scope);
    if (scope === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_SCOPE",
          message: "Conversation list scope must be active or archived.",
        },
      });
      return;
    }

    const cursor = parseOptionalCursorQuery(request.query.cursor);
    if (cursor === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_CURSOR",
          message: "Conversation list cursor must be a single non-empty string.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation bootstrap is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const page = await service.listConversationPage({
        userId: request.webUserId,
        limit,
        ...(scope ? { scope } : {}),
        ...(cursor ? { cursor } : {}),
      });
      response.json({
        success: true,
        data: {
          conversations: page.conversations,
          nextCursor: page.nextCursor,
        },
      });
    } catch (error) {
      if (error instanceof RangeError) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_NATIVE_LIVE_CONVERSATION_LIST_CURSOR",
            message: error.message,
          },
        });
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversations are temporarily unavailable.",
        },
      });
    }
  };
}

export function createNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const parsed = parseCreateConversationBody(request.body);
    if (!parsed.ok) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_CREATE",
          message:
            "Conversation title must be null or a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation bootstrap is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const conversation = await service.createConversation({
        userId: request.webUserId,
        title: parsed.title,
      });
      response.status(201).json({
        success: true,
        data: {
          id: conversation.id,
          title: conversation.title,
          currentHeadMessageId: conversation.currentHeadMessageId,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_BOOTSTRAP_UNAVAILABLE",
          message: "Native live conversation could not be created.",
        },
      });
    }
  };
}

export function renameNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }

    const body = exactBody(request.body, ["title"]);
    const title = body?.title;
    if (typeof title !== "string") {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_RENAME",
          message:
            "Conversation title must be a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_RENAME",
          message:
            "Conversation title must be a non-empty string up to 200 characters.",
        },
      });
      return;
    }

    const service = dependencies.conversationService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message:
            "Native live conversation lifecycle is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const renamed = await service.renameConversation({
        userId: request.webUserId,
        conversationId,
        title: trimmedTitle,
      });

      if (!renamed) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }

      response.json({
        success: true,
        data: renamed,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message:
            "Native live conversation could not be renamed.",
        },
      });
    }
  };
}

export function archiveNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }
    try {
      const result = await dependencies.conversationService!.archiveConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_BUSY",
            message:
              "Native live conversation has an active turn and cannot be archived yet.",
          },
        });
        return;
      }
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be archived.",
        },
      });
    }
  };
}

export function restoreNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }
    try {
      const result = await dependencies.conversationService!.restoreConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Archived native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be restored.",
        },
      });
    }
  };
}

export function deleteNativeLiveConversationHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;
    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }
    if (request.query.confirm !== "true") {
      response.status(400).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_DELETE_CONFIRMATION_REQUIRED",
          message: "True conversation deletion requires confirm=true.",
        },
      });
      return;
    }
    try {
      const result = await dependencies.conversationService!.deleteConversation({
        userId: request.webUserId,
        conversationId,
      });
      if (result.outcome === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_BUSY",
            message:
              "Native live conversation has an active turn and cannot be deleted yet.",
          },
        });
        return;
      }
      if (result.outcome === "not_found") {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.status(204).end();
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CONVERSATION_LIFECYCLE_UNAVAILABLE",
          message: "Native live conversation could not be deleted.",
        },
      });
    }
  };
}

export function waitNativeLiveConversationHeadHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const conversationId =
      routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }

    const body = exactBody(request.body, ["after_head_message_id"]);
    const afterHeadMessageId = body?.after_head_message_id;
    if (
      !body
      || !(
        afterHeadMessageId === null
        || (
          typeof afterHeadMessageId === "string"
          && UUID_PATTERN.test(afterHeadMessageId)
        )
      )
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_HEAD_WAIT",
          message:
            "after_head_message_id must be a UUID or null.",
        },
      });
      return;
    }

    const service = dependencies.conversationHeadWaitService;
    if (!service) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_HEAD_WAIT_UNAVAILABLE",
          message:
            "Conversation head wait is temporarily unavailable.",
        },
      });
      return;
    }

    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.once("close", onClose);
    try {
      const result = await service.wait({
        userId: request.webUserId,
        conversationId,
        afterHeadMessageId,
        timeoutMs: 25_000,
        signal: controller.signal,
      });
      if (response.writableEnded || controller.signal.aborted) return;
      if (!result) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: result,
      });
    } catch {
      if (response.writableEnded || controller.signal.aborted) return;
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_HEAD_WAIT_UNAVAILABLE",
          message:
            "Conversation head wait is temporarily unavailable.",
        },
      });
    } finally {
      response.off("close", onClose);
    }
  };
}

export function readNativeLiveConversationRuntimeMetadataHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const conversationId = routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Conversation id must be a UUID.",
        },
      });
      return;
    }

    const reader = dependencies.conversationRuntimeMetadataReader;
    if (!reader) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_METADATA_UNAVAILABLE",
          message:
            "Native live conversation runtime metadata is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const snapshot = await reader.readLatest({
        userId: request.webUserId,
        conversationId,
      });
      if (!snapshot) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }
      response.json({
        success: true,
        data: snapshot,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_METADATA_UNAVAILABLE",
          message:
            "Native live conversation runtime metadata is temporarily unavailable.",
        },
      });
    }
  };
}

export function readNativeLiveCurrentPathHandler(
  dependencies: NativeLiveApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const conversationId =
      routeParam(request.params.conversationId);
    if (!UUID_PATTERN.test(conversationId)) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CONVERSATION_ID",
          message: "Native live conversation id is invalid.",
        },
      });
      return;
    }

    const limit = parseCurrentPathLimit(request.query.limit);
    if (limit === null) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CURRENT_PATH_LIMIT",
          message:
            `Current path limit must be an integer from 1 to ${MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT}.`,
        },
      });
      return;
    }

    const beforeMessageId =
      parseOptionalUuidQuery(request.query.before_message_id);
    const afterMessageId =
      parseOptionalUuidQuery(request.query.after_message_id);
    if (
      beforeMessageId === null
      || afterMessageId === null
      || (beforeMessageId && afterMessageId)
    ) {
      response.status(400).json({
        success: false,
        error: {
          code: "INVALID_NATIVE_LIVE_CURRENT_PATH_CURSOR",
          message:
            "Current path accepts one valid before_message_id or after_message_id cursor.",
        },
      });
      return;
    }

    const reader = dependencies.currentPathReader;
    if (!reader) {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CURRENT_PATH_UNAVAILABLE",
          message:
            "Native live current path is temporarily unavailable.",
        },
      });
      return;
    }

    try {
      const snapshot = await reader.readCurrentPath({
        userId: request.webUserId,
        conversationId,
        limit,
        ...(beforeMessageId ? { beforeMessageId } : {}),
        ...(afterMessageId ? { afterMessageId } : {}),
      });
      if (!snapshot) {
        response.status(404).json({
          success: false,
          error: {
            code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
            message: "Native live conversation was not found.",
          },
        });
        return;
      }

      const etag = nativeLiveCurrentPathEtag(
        snapshot.syncToken,
        limit,
        { beforeMessageId, afterMessageId },
        snapshot.failedTurn
          ? `${nativeLiveCurrentPathActivityRevision(snapshot.messages) ?? "-"}:failed:${snapshot.failedTurn.prepareId}`
          : nativeLiveCurrentPathActivityRevision(snapshot.messages),
      );
      response.setHeader("ETag", etag);
      if (ifNoneMatchContains(request.header("if-none-match"), etag)) {
        response.status(304).end();
        return;
      }

      response.json({
        success: true,
        data: {
          conversationId: snapshot.conversationId,
          title: snapshot.title,
          currentHeadMessageId:
            snapshot.currentHeadMessageId,
          updatedAt: snapshot.updatedAt,
          syncToken: snapshot.syncToken,
          truncated: snapshot.truncated,
          olderCursor: snapshot.olderCursor,
          resetRequired: snapshot.resetRequired,
          messages: snapshot.messages,
          failedTurn: snapshot.failedTurn ?? null,
        },
      });
    } catch (error) {
      if (error instanceof RangeError) {
        response.status(400).json({
          success: false,
          error: {
            code: "INVALID_NATIVE_LIVE_CURRENT_PATH_CURSOR",
            message: error.message,
          },
        });
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_CURRENT_PATH_UNAVAILABLE",
          message:
            "Native live current path is temporarily unavailable.",
        },
      });
    }
  };
}

const DEFAULT_NATIVE_LIVE_CONVERSATION_LIST_LIMIT = 50;

const MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT = 100;

function parseConversationListLimit(
  value: unknown,
): number | null {
  if (value === undefined) {
    return DEFAULT_NATIVE_LIVE_CONVERSATION_LIST_LIMIT;
  }
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]{0,2}$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return (
    Number.isInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_NATIVE_LIVE_CONVERSATION_LIST_LIMIT
  )
    ? parsed
    : null;
}

function parseCreateConversationBody(
  value: unknown,
): { ok: true; title: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, title: null };
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    return { ok: false };
  }

  const title = (value as Record<string, unknown>).title;
  if (title === undefined || title === null) {
    return { ok: true, title: null };
  }
  if (typeof title !== "string") return { ok: false };

  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return { ok: false };
  }
  return { ok: true, title: trimmed };
}

function parseConversationListScope(
  value: unknown,
): "active" | "archived" | undefined | null {
  if (value === undefined) return undefined;
  return value === "active" || value === "archived"
    ? value
    : null;
}

function parseOptionalCursorQuery(
  value: unknown,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

function parseOptionalUuidQuery(
  value: unknown,
): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

function parseCurrentPathLimit(
  value: unknown,
): number | null {
  if (value === undefined) {
    return DEFAULT_NATIVE_LIVE_CURRENT_PATH_LIMIT;
  }
  if (
    typeof value !== "string"
    || !/^[1-9][0-9]{0,2}$/u.test(value)
  ) {
    return null;
  }
  const parsed = Number(value);
  return (
    Number.isInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_NATIVE_LIVE_CURRENT_PATH_LIMIT
  )
    ? parsed
    : null;
}

function nativeLiveCurrentPathActivityRevision(
  messages: Array<{
    id: string;
    activity?: {
      prepareId: string | null;
      durationMs?: number;
      events: Array<{ sequence: number }>;
      interactions: Array<{ updatedAt: string }>;
    } | null;
  }>,
): string | null {
  const parts = messages.flatMap((message) => {
    const activity = message.activity;
    if (!activity) return [];

    const latestEventSequence =
      activity.events.at(-1)?.sequence ?? 0;
    const latestInteractionUpdatedAt =
      activity.interactions.reduce(
        (latest, interaction) =>
          interaction.updatedAt > latest
            ? interaction.updatedAt
            : latest,
        "-",
      );

    return [
      [
        message.id,
        activity.prepareId,
        String(activity.events.length),
        String(latestEventSequence),
        String(activity.interactions.length),
        latestInteractionUpdatedAt,
        String(activity.durationMs ?? "-"),
      ].join(":"),
    ];
  });

  if (parts.length === 0) return null;

  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

function ifNoneMatchContains(
  value: string | undefined,
  etag: string,
): boolean {
  if (!value) return false;
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) =>
      candidate === "*"
      || candidate === etag
      || candidate === `W/${etag}`
    );
}
