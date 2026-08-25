import express from "express";
import { createInternalAuthMiddleware } from "../auth/internal-auth.js";
import {
  createAuth0JwtVerifier,
  type AccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { createOAuthMiddleware } from "../auth/oauth-middleware.js";
import { env, getMcpGovernanceConfig, requireOAuthConfig } from "../config/env.js";
import { getWebApiConfig } from "../config/env.js";
import { createDatabase, createDatabaseReadinessProbe } from "../database/client.js";
import {
  createDatabaseReadinessGate,
  MIGRATION_READINESS_BACKOFF_MS,
  MIGRATION_READINESS_MAX_ATTEMPTS,
  MIGRATION_READINESS_MAX_BACKOFF_MS,
} from "../database/migration-readiness.js";
import { createMcpRouter } from "../mcp/server/router.js";
import {
  McpSessionRegistry,
  type McpSessionObserverEvent,
} from "../mcp/server/session-registry.js";
import {
  deleteExpiredMcpIdempotency,
  McpIdempotencyCleanupCoordinator,
  type IdempotencyCleanupObserverEvent,
} from "../mcp/server/idempotency-retention.js";
import { createProtectedResourceMetadataHandler } from "../oauth/protected-resource-metadata.js";
import { createWebApiRouter } from "../web-api/router.js";
import { createWebApiAuthMiddleware } from "../web-api/web-api-auth.js";
import { createWebApiCorsMiddleware } from "../web-api/web-api-cors.js";

import { DrizzleMemoryRepository } from "../domains/memory/memory-repository.js";
import { MemoryService } from "../domains/memory/memory-service.js";
import type { MemoryApiDependencies } from "../web-api/memory-router.js";

import { DrizzleDiaryRepository } from "../domains/diary/diary-repository.js";
import { DiaryService } from "../domains/diary/diary-service.js";
import type { DiaryApiDependencies } from "../web-api/diary-router.js";

import { DrizzleTaskRepository } from "../domains/task/task-repository.js";
import { TaskService } from "../domains/task/task-service.js";
import type { TaskApiDependencies } from "../web-api/task-router.js";

import { DrizzleToyCommandRepository } from "../domains/toy/toy-command-repository.js";
import { ToyCommandService } from "../domains/toy/toy-command-service.js";
import {
  createToyBridgeRouter,
  type ToyApiDependencies,
} from "../web-api/toy-router.js";
import { DrizzleGlobalSearchRepository } from "../domains/global-search/global-search-repository.js";
import { GlobalSearchService } from "../domains/global-search/global-search-service.js";
import type { GlobalSearchApiDependencies } from "../web-api/global-search-router.js";
import { DrizzleSystemRepository } from "../domains/system/system-repository.js";
import { SystemService } from "../domains/system/system-service.js";
import type { SystemApiDependencies } from "../web-api/system-router.js";
import { DrizzleTodoRepository } from "../domains/todo/todo-repository.js";
import { TodoService } from "../domains/todo/todo-service.js";
import type { TodoApiDependencies } from "../web-api/todo-router.js";
import { DrizzleExportRepository } from "../domains/export/export-repository.js";
import { ExportService } from "../domains/export/export-service.js";
import type { ExportApiDependencies } from "../web-api/export-router.js";
import { DrizzleImportRepository } from "../domains/import/import-repository.js";
import { ImportService } from "../domains/import/import-service.js";
import type { ImportApiDependencies } from "../web-api/import-router.js";
import { DrizzleUniverseRepository } from "../domains/universe/universe-repository-drizzle.js";
import { UniverseService } from "../domains/universe/universe-service.js";
import type { UniverseApiDependencies } from "../web-api/universe-router.js";

export type AppDependencies = {
  verifyAccessToken?: AccessTokenVerifier;
  verifyWebAccessToken?: AccessTokenVerifier;
  webMemoryService?: MemoryApiDependencies["memoryService"];
  webDiaryService?: DiaryApiDependencies["diaryService"];
  webTaskService?: TaskApiDependencies["taskService"];
  webSystemService?: SystemApiDependencies["systemService"];
  toyService?: ToyApiDependencies["toyService"];
  webGlobalSearchService?: GlobalSearchApiDependencies["globalSearchService"];
  webTodoService?: TodoApiDependencies["todoService"];
  webExportService?: ExportApiDependencies["exportService"];
  webImportService?: ImportApiDependencies["importService"];
  webUniverseService?: UniverseApiDependencies["universeService"];
};

function observeMcpLifecycle(
  event: McpSessionObserverEvent | IdempotencyCleanupObserverEvent,
): void {
  const safeFields = Object.fromEntries(
    Object.entries(event).filter(([key]) =>
      [
        "name",
        "namespace",
        "reason",
        "activeSessionCount",
        "activeNamespaceCount",
        "deletedRows",
        "durationMs",
        "diagnosticSessionOrdinal",
        "protocolVersion",
        "clientName",
        "clientVersion",
        "hadUnknownSessionHeader",
        "activeUserNamespaceCount",
        "idleUserNamespaceCount",
        "inFlightUserNamespaceCount",
        "oldestIdleAgeMs",
        "inFlightCountAtClose",
        "idleAgeMsAtClose",
      ].includes(key),
    ),
  );
  if (event.name === "mcp_idempotency_cleanup_failed") {
    console.warn("MCP lifecycle event", safeFields);
    return;
  }
  console.info("MCP lifecycle event", safeFields);
}

export function createApp(
  dependencies: AppDependencies = {},
): express.Express {
  const app = express();
  const config = requireOAuthConfig(env);
  const mcpGovernance = getMcpGovernanceConfig(env);
  const mcpSessionRegistry = new McpSessionRegistry({
    idleTtlMs: mcpGovernance.idleTtlSeconds * 1_000,
    absoluteTtlMs: mcpGovernance.absoluteTtlSeconds * 1_000,
    maxPerUser: mcpGovernance.maxPerUser,
    maxTotal: mcpGovernance.maxTotal,
    observer: observeMcpLifecycle,
  });

  const databaseReadiness = env.DATABASE_URL
    ? createDatabaseReadinessGate(
        createDatabaseReadinessProbe(env.DATABASE_URL),
        {
          maxAttempts: MIGRATION_READINESS_MAX_ATTEMPTS,
          backoffMs: MIGRATION_READINESS_BACKOFF_MS,
          maxBackoffMs: MIGRATION_READINESS_MAX_BACKOFF_MS,
          onRetry: ({ attempt, maxAttempts, name, code }) => {
            console.warn(
              `Database readiness retry. stage=request attempt=${attempt}/${maxAttempts} name=${name} code=${code}`,
            );
          },
        },
      )
    : undefined;

  const databaseReadinessMiddleware: express.RequestHandler = async (
    _request,
    response,
    next,
  ) => {
    if (!databaseReadiness) {
      next();
      return;
    }
    try {
      await databaseReadiness();
      next();
    } catch {
      console.error("Database readiness failed after bounded retry. stage=request");
      response.status(503).json({
        success: false,
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database is temporarily unavailable.",
        },
      });
    }
  };

  let mcpIdempotencyCleanup: McpIdempotencyCleanupCoordinator | undefined;
  if (env.DATABASE_URL) {
    const { db } = createDatabase(env.DATABASE_URL);
    mcpIdempotencyCleanup = new McpIdempotencyCleanupCoordinator({
      retentionMs: mcpGovernance.idempotencyRetentionDays * 24 * 60 * 60 * 1_000,
      intervalMs: mcpGovernance.idempotencyCleanupIntervalHours * 60 * 60 * 1_000,
      cleanup: (cutoff) => deleteExpiredMcpIdempotency(db, cutoff),
      observer: observeMcpLifecycle,
    });
  }

  const verifyAccessToken =
    dependencies.verifyAccessToken ??
    createAuth0JwtVerifier({
      issuer: config.AUTH0_ISSUER,
      audience: config.AUTH0_AUDIENCE,
      jwksUri: config.AUTH0_JWKS_URI,
      requiredScope: config.AUTH0_REQUIRED_SCOPE,
    });

  const metadataHandler =
    createProtectedResourceMetadataHandler(config);

  const webApiConfig = getWebApiConfig(env);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      success: true,
      data: {
        service: "leilei-os",
        status: "ok",
      },
    });
  });

  app.get(
    "/.well-known/oauth-protected-resource",
    metadataHandler,
  );

  app.get(
    "/.well-known/oauth-protected-resource/mcp",
    metadataHandler,
  );

  app.get("/oauth", (_request, response) => {
    response
      .type("text/plain")
      .send(
        "Leilei OS uses OAuth 2.1 to authorize access to its public MCP endpoint.",
      );
  });

  if (webApiConfig) {
    const verifyWebAccessToken =
      dependencies.verifyWebAccessToken ??
      createAuth0JwtVerifier({
        issuer: webApiConfig.AUTH0_ISSUER,
        audience: webApiConfig.WEB_AUTH0_AUDIENCE,
        jwksUri: webApiConfig.AUTH0_JWKS_URI,
        requiredScope:
          webApiConfig.WEB_AUTH0_REQUIRED_SCOPE,
      });

    let webMemoryService =
      dependencies.webMemoryService;

    let webDiaryService =
      dependencies.webDiaryService;

    let webTaskService =
      dependencies.webTaskService;

    let webSystemService = dependencies.webSystemService;
    let toyService = dependencies.toyService;
    let webGlobalSearchService = dependencies.webGlobalSearchService;
    let webTodoService = dependencies.webTodoService;
    let webExportService = dependencies.webExportService;
    let webImportService = dependencies.webImportService;
    let webUniverseService = dependencies.webUniverseService;

    if (
      !webMemoryService ||
      !webDiaryService ||
      !webTaskService ||
      !webSystemService ||
      !toyService ||
      !webGlobalSearchService ||
      !webTodoService ||
      !webExportService ||
      !webImportService
      || !webUniverseService
    ) {
      if (!env.DATABASE_URL) {
        throw new Error(
          "Web API database is not configured.",
        );
      }

      const { db } = createDatabase(env.DATABASE_URL);

      if (!webMemoryService) {
        webMemoryService = new MemoryService(
          new DrizzleMemoryRepository(db),
        );
      }

      if (!webDiaryService) {
        webDiaryService = new DiaryService(
          new DrizzleDiaryRepository(db),
        );
      }

      if (!webTaskService) {
        webTaskService = new TaskService(
          new DrizzleTaskRepository(db),
        );
      }

      if (!webSystemService) {
        webSystemService = new SystemService(
          new DrizzleSystemRepository(db),
          { internalMcpEnabled: Boolean(config.MCP_AUTH_TOKEN) },
        );
      }

      if (!toyService) {
        toyService = new ToyCommandService(
          new DrizzleToyCommandRepository(db),
          env.LEILEI_TOY_BRIDGE_USER_ID,
        );
      }
      if (!webGlobalSearchService) {
        webGlobalSearchService = new GlobalSearchService(new DrizzleGlobalSearchRepository(db));
      }
      if (!webTodoService) webTodoService = new TodoService(new DrizzleTodoRepository(db));
      if (!webExportService) webExportService = new ExportService(new DrizzleExportRepository(db));
      if (!webImportService) webImportService = new ImportService(new DrizzleImportRepository(db));
      if (!webUniverseService) webUniverseService = new UniverseService(new DrizzleUniverseRepository(db));
    }

    if (
      !webMemoryService ||
      !webDiaryService ||
      !webTaskService ||
      !webSystemService ||
      !toyService ||
      !webGlobalSearchService ||
      !webTodoService ||
      !webExportService ||
      !webImportService
      || !webUniverseService
    ) {
      throw new Error(
        "Web API services are not configured.",
      );
    }

    app.use(
      "/api/v1/toy/commands",
      createToyBridgeRouter(
        { toyService },
        env.LEILEI_TOY_BRIDGE_KEY,
      ),
    );

    app.use(
      "/api/v1",
      createWebApiCorsMiddleware(
        webApiConfig.WEB_APP_ORIGIN,
      ),
      createWebApiAuthMiddleware(
        webApiConfig,
        verifyWebAccessToken,
      ),
      databaseReadinessMiddleware,
      createWebApiRouter({
        memory: {
          memoryService: webMemoryService,
        },
        diary: {
          diaryService: webDiaryService,
        },
        task: {
          taskService: webTaskService,
        },
        system: { systemService: webSystemService },
        toy: {
          toyService,
        },
        globalSearch: { globalSearchService: webGlobalSearchService },
        todo: { todoService: webTodoService },
        export: { exportService: webExportService },
        import: { importService: webImportService },
        universe: { universeService: webUniverseService },
      }),
    );
  }

  app.use(
    "/mcp",
    createOAuthMiddleware(config, verifyAccessToken),
    databaseReadinessMiddleware,
    createMcpRouter({
      namespace: "public",
      registry: mcpSessionRegistry,
      onInitialize: () => mcpIdempotencyCleanup?.maybeCleanup() ?? Promise.resolve(),
    }),
  );

  if (config.MCP_AUTH_TOKEN) {
    app.use(
      "/internal/mcp",
      createInternalAuthMiddleware(
        config.MCP_AUTH_TOKEN,
        config.MCP_USER_ID,
      ),
      databaseReadinessMiddleware,
      createMcpRouter({
        namespace: "internal",
        registry: mcpSessionRegistry,
        onInitialize: () => mcpIdempotencyCleanup?.maybeCleanup() ?? Promise.resolve(),
      }),
    );
  }

  app.use((_request, response) => {
    response.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
      },
    });
  });

  return app;
}
