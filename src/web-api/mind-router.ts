import { Router, type RequestHandler, type Response } from "express";
import type { CurrentSubjectStateKind } from "../domains/runtime/subject-state/subject-state-contract.js";
import {
  MindProductServiceError,
  type MindProductService,
} from "../domains/runtime/mind/mind-product-service.js";

export type MindApiDependencies = {
  mindService: Pick<
    MindProductService,
    "list" | "get" | "createManual" | "delete" | "readMessageWrites"
  >;
};

export function createMindApiRouter(
  dependencies: MindApiDependencies,
): Router {
  const router = Router();

  router.get("/", handler(async (request) => {
    const kind = readOptionalKind(request.query.kind);
    const limit = readOptionalLimit(request.query.limit);
    const cursor = readOptionalString(request.query.cursor, "cursor");
    return dependencies.mindService.list({
      userId: request.webUserId!,
      ...(kind ? { kind } : {}),
      ...(limit ? { limit } : {}),
      ...(cursor ? { cursor } : {}),
    });
  }));

  router.get(
    "/writes/messages/:messageId",
    handler(async (request) =>
      dependencies.mindService.readMessageWrites({
        userId: request.webUserId!,
        messageId: routeParam(request.params.messageId),
      })),
  );

  router.get(
    "/:stateId",
    handler(async (request) =>
      dependencies.mindService.get({
        userId: request.webUserId!,
        stateId: routeParam(request.params.stateId),
      })),
  );

  router.post("/", handler(async (request) => {
    const body = bodyRecord(request.body);
    rejectUnknownFields(body, [
      "kind",
      "text",
      "occurred_at",
      "note",
    ]);
    return dependencies.mindService.createManual({
      userId: request.webUserId!,
      kind: readKind(body.kind),
      text: readRequiredString(body.text, "text"),
      occurredAt:
        body.occurred_at === undefined
          ? undefined
          : readNullableString(body.occurred_at, "occurred_at"),
      note:
        body.note === undefined
          ? undefined
          : readNullableString(body.note, "note"),
      idempotencyKey: request.get("Idempotency-Key"),
    });
  }, 201));

  router.delete(
    "/:stateId",
    handler(async (request) =>
      dependencies.mindService.delete({
        userId: request.webUserId!,
        stateId: routeParam(request.params.stateId),
      })),
  );

  return router;
}

function handler(
  operation: (request: Parameters<RequestHandler>[0]) => Promise<unknown>,
  successStatus = 200,
): RequestHandler {
  return async (request, response) => {
    noStore(response);
    if (!requireUser(response, request.webUserId)) return;
    try {
      rejectClientIdentity(request.body, request.query);
      const data = await operation(request);
      response.status(successStatus).json({ success: true, data });
    } catch (error) {
      sendMindError(response, error);
    }
  };
}

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Pragma", "no-cache");
}

function requireUser(
  response: Response,
  userId: string | undefined,
): userId is string {
  if (userId) return true;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "Web API authentication is required.",
    },
  });
  return false;
}

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      "Mind request body must be an object.",
    );
  }
  return value as Record<string, unknown>;
}

function readKind(value: unknown): CurrentSubjectStateKind {
  if (
    value === "feel"
    || value === "memory"
    || value === "thought"
  ) {
    return value;
  }
  throw new MindProductServiceError(
    "INVALID_MIND",
    "Mind kind is invalid.",
  );
}

function readOptionalKind(
  value: unknown,
): CurrentSubjectStateKind | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new MindProductServiceError("INVALID_MIND");
  }
  return readKind(value);
}

function readOptionalLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== "string") {
    throw new MindProductServiceError("INVALID_MIND");
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new MindProductServiceError("INVALID_MIND");
  }
  return parsed;
}

function readOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== "string" || !value.trim()) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${field} must be a non-empty string.`,
    );
  }
  return value;
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${field} must be a non-empty string.`,
    );
  }
  return value;
}

function readNullableString(
  value: unknown,
  field: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new MindProductServiceError(
      "INVALID_MIND",
      `${field} must be a string or null.`,
    );
  }
  return value;
}

function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      "Mind request contains unsupported fields.",
    );
  }
}

function rejectClientIdentity(
  body: unknown,
  query: Record<string, unknown>,
): void {
  const containsIdentity = (
    value: unknown,
    seen = new Set<object>(),
  ): boolean => {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    if (
      Object.prototype.hasOwnProperty.call(value, "user_id")
      || Object.prototype.hasOwnProperty.call(value, "userId")
      || Object.prototype.hasOwnProperty.call(value, "subject_id")
      || Object.prototype.hasOwnProperty.call(value, "subjectId")
    ) {
      return true;
    }
    if (Array.isArray(value)) {
      return value.some((item) => containsIdentity(item, seen));
    }
    return Object.values(value).some((item) =>
      containsIdentity(item, seen)
    );
  };

  if (containsIdentity(body) || containsIdentity(query)) {
    throw new MindProductServiceError(
      "INVALID_MIND",
      "Client identity selectors are not accepted.",
    );
  }
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendMindError(response: Response, error: unknown): void {
  if (!(error instanceof MindProductServiceError)) {
    response.status(503).json({
      success: false,
      error: {
        code: "MIND_FAILED",
        message: "Mind is temporarily unavailable.",
      },
    });
    return;
  }

  if (error.code === "INVALID_MIND") {
    response.status(400).json({
      success: false,
      error: {
        code: error.code,
        message: "Mind request is invalid.",
      },
    });
    return;
  }
  if (error.code === "INVALID_IDEMPOTENCY_KEY") {
    response.status(400).json({
      success: false,
      error: {
        code: error.code,
        message:
          "Idempotency-Key is required for durable create requests.",
      },
    });
    return;
  }
  if (error.code === "IDEMPOTENCY_CONFLICT") {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          "Idempotency-Key was already used for a different request.",
      },
    });
    return;
  }
  if (error.code === "MIND_NOT_FOUND") {
    response.status(404).json({
      success: false,
      error: {
        code: error.code,
        message: "Mind state was not found.",
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "MIND_FAILED",
      message: "Mind is temporarily unavailable.",
    },
  });
}
