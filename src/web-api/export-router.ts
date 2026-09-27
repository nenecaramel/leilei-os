import { Router, type RequestHandler, type Response } from "express";
import { ExportServiceError, type ExportService } from "../domains/export/export-service.js";
import type { ExportScope } from "../domains/export/export-types.js";

export type ExportApiDependencies = {
  exportService: Pick<ExportService, "createExport">;
};

const EXPORT_SCOPES = new Set<ExportScope>([
  "all",
  "diary",
  "todo",
]);

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

    const scopeValue = exactlyOneQueryValue(request.query.scope);
    const includeAuditValue = exactlyOneOptionalQueryValue(request.query.include_audit);
    const scope = scopeValue && EXPORT_SCOPES.has(scopeValue as ExportScope)
      ? scopeValue as ExportScope
      : undefined;
    const includeAudit = includeAuditValue === undefined
      ? false
      : includeAuditValue === "false"
        ? false
        : includeAuditValue === "true"
          ? true
          : undefined;

    if (!scope || includeAudit === undefined) {
      sendInvalidExportRequest(response);
      return;
    }

    try {
      const document = await dependencies.exportService.createExport(
        request.webUserId!,
        scope,
        includeAudit,
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

function exactlyOneQueryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function exactlyOneOptionalQueryValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : "__invalid__";
}

function toExportFilename(exportedAt: string): string {
  const compact = exportedAt
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")
    .replace(/[^0-9TZ]/gu, "");
  return `leileios-export-${compact}.json`;
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
        message:
          "Finish current runtime processing before exporting all data.",
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
