import { Router, type RequestHandler, type Response } from "express";
import { ExportServiceError, type ExportService } from "../domains/export/export-service.js";

export type ExportApiDependencies = {
  exportService: Pick<ExportService, "createExport">;
};

export function createExportApiRouter(
  dependencies: ExportApiDependencies,
): Router {
  const router = Router();
  router.get("/", createExportApiHandler(dependencies));
  return router;
}

export function createExportApiHandler(
  dependencies: ExportApiDependencies,
): RequestHandler {
  return async (request, response) => {
    if (!requireWebUser(response, request.webUserId)) return;

    const scopeValue = exactlyOneOptionalQueryValue(request.query.scope);
    // scope=all remains accepted temporarily for older clients, but partial
    // product exports are retired. New clients omit scope entirely.
    if (
      (scopeValue !== undefined && scopeValue !== "all")
    ) {
      sendInvalidExportRequest(response);
      return;
    }

    try {
      const document = await dependencies.exportService.createExport(
        request.webUserId!,
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${toExportFilename(document.exported_at)}"`,
      );
      response.type("application/json").json(document);
    } catch (error) {
      sendExportError(response, error);
    }
  };
}

function exactlyOneOptionalQueryValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : "__invalid__";
}

function toExportFilename(
  exportedAt: string,
): string {
  const compact = exportedAt
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/[^0-9TZ]/gu, "");
  return `leileios-full-backup_${compact}.json`;
}

function requireWebUser(response: Response, userId: string | undefined): userId is string {
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

function sendInvalidExportRequest(response: Response): void {
  response.status(400).json({
    success: false,
    error: {
      code: "INVALID_EXPORT_REQUEST",
      message: "Export request is invalid.",
    },
  });
}

function sendExportError(response: Response, error: unknown): void {
  if (
    error instanceof ExportServiceError
    && error.code === "EXPORT_TOO_LARGE"
  ) {
    response.status(413).json({
      success: false,
      error: {
        code: "EXPORT_TOO_LARGE",
        message:
          "Product data is too large for the current portable backup format.",
      },
    });
    return;
  }
  if (
    error instanceof ExportServiceError
    && error.code === "EXPORT_IN_PROGRESS"
  ) {
    response.status(409).json({
      success: false,
      error: {
        code: "EXPORT_IN_PROGRESS",
        reason: error.reason,
        message:
          error.reason === "prepared_turn"
            ? "A chat turn is still being finalized."
            : error.reason === "mind_followup"
              ? "A Mind update is still being finalized."
              : error.reason === "canonical_message"
                ? "A canonical chat message is still being finalized."
                : "Finish current runtime processing before exporting all data.",
      },
    });
    return;
  }
  const forbidden =
    error instanceof ExportServiceError
    && (
      error.code === "USER_NOT_FOUND"
      || error.code === "USER_DISABLED"
    );
  response.status(forbidden ? 403 : 503).json({
    success: false,
    error: {
      code: "EXPORT_UNAVAILABLE",
      message: "Export data is temporarily unavailable.",
    },
  });
}
