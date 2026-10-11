import type { NativeLiveProviderSessionStoreInternalDependencies } from "../web-api/native-live-provider-session-store-internal-router.js";
import { createMindRecallRouter } from "../web-api/mind-recall-internal-router.js";
import express from "express";
import { createInternalAuthMiddleware } from "../auth/internal-auth.js";
import {
  createAuth0JwtVerifier,
  type AccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { createOAuthMiddleware } from "../auth/oauth-middleware.js";
import {
  env,
  getMcpGovernanceConfig,
  getOAuthAuthorizationServerConfig,
  requireOAuthConfig,
} from "../config/env.js";
import { getWebApiConfig } from "../config/env.js";
import {
  createDatabaseReadinessGate,
  MIGRATION_READINESS_BACKOFF_MS,
  MIGRATION_READINESS_MAX_BACKOFF_MS,
  RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS,
} from "../database/migration-readiness.js";
import { createMcpRouter } from "../mcp/server/router.js";
import {
  McpSessionRegistry,
} from "../mcp/server/session-registry.js";
import type { McpSessionServerFactory } from "../mcp/server/production-server-factory.js";
import { createProtectedResourceMetadataHandler } from "../oauth/protected-resource-metadata.js";
import { createClientRegistry } from "../oauth/client-registry.js";
import { createOAuthAuthorizationServer } from "../oauth/oauth-authorization-server.js";
import { createSecureMetadataFetcher } from "../oauth/secure-metadata-fetch.js";
import { createAuth0CodeExchange } from "../oauth/upstream-client.js";
import { createWebApiRouter } from "../web-api/router.js";
import { createWebApiAuthMiddleware } from "../web-api/web-api-auth.js";
import { createWebApiCorsMiddleware } from "../web-api/web-api-cors.js";
import { createHttpObservabilityMiddleware } from "../observability/http-observability.js";
import {
  createSafeLogger,
  safeErrorFingerprint,
  type SafeLogger,
} from "../observability/logger.js";
import { createMcpLifecycleObserver } from "../observability/runtime-observers.js";

import type { DiaryApiDependencies } from "../web-api/diary-router.js";
import {
  createToyBridgeRouter,
  type ToyApiDependencies,
} from "../web-api/toy-router.js";
import type { GlobalSearchApiDependencies } from "../web-api/global-search-router.js";
import type { SystemApiDependencies } from "../web-api/system-router.js";
import type { TodoApiDependencies } from "../web-api/todo-router.js";
import type { ExportApiDependencies } from "../web-api/export-router.js";
import type { ImportApiDependencies } from "../web-api/import-router.js";
import type { UniverseApiDependencies } from "../web-api/universe-router.js";
import type { MindApiDependencies } from "../web-api/mind-router.js";
import type { NativeLiveApiDependencies } from "../web-api/native-live-router.js";
import {
  createNativeLiveRelayInternalRouter,
  type NativeLiveRelayInternalDependencies,
} from "../web-api/native-live-relay-internal-router.js";
import {
  createNativeLiveProviderSessionStoreInternalRouter,
} from "../web-api/native-live-provider-session-store-internal-router.js";
import type {
  NativeLiveProviderSessionStoreService,
} from "../domains/bridge/provider-session/native-live-provider-session-store.js";
import {
  createHealthSyncRouter,
  type HealthSyncApiDependencies,
} from "../web-api/health-sync-router.js";
import { createHealthSyncAuthMiddleware } from "../web-api/health-sync-auth.js";
import {
  createNativeLiveAttachmentTransferRouter,
} from "../web-api/native-live-attachment-transfer-router.js";
import type {
  PostgresInlineAttachmentObjectStore,
} from "../domains/bridge/attachment/native-live-attachment-postgres-storage.js";

export type NativeLiveProductionDependencies = {
  web:
    Required<
      Omit<
        NativeLiveApiDependencies,
        "manualCompactService" | "externalSessionBridgeService" | "attachmentService"
      >
    >
    & Pick<
      NativeLiveApiDependencies,
      "manualCompactService" | "externalSessionBridgeService" | "attachmentService"
    >;
  internal:
    Required<
      Omit<
        NativeLiveRelayInternalDependencies,
        "observeCompanionBackgroundOpportunity"
        | "manualCompactService"
        | "externalSessionBridgeService"
        | "attachmentService"
      >
    >
    & Pick<
      NativeLiveRelayInternalDependencies,
      "observeCompanionBackgroundOpportunity"
      | "manualCompactService"
      | "externalSessionBridgeService"
      | "attachmentService"
    >
    & {
      providerSessionStoreService:
        NativeLiveProviderSessionStoreService;
    } & Pick<NativeLiveProviderSessionStoreInternalDependencies, "restoreNativeHistory" | "readNativeHistoryState" | "releaseNativeHistory" | "nativeHistoryAsset" | "listNativeHistoryChoices">;
};

export type AppDependencies = {
  logger?: SafeLogger;
  nativeLiveAttachmentTransferStore?: Pick<
    PostgresInlineAttachmentObjectStore,
    "transferMaxFileBytes" | "putTransfer" | "getTransfer"
  >;
  nativeLiveProduction?: NativeLiveProductionDependencies;
  verifyAccessToken?: AccessTokenVerifier;
  verifyWebAccessToken?: AccessTokenVerifier;
  webDiaryService?: DiaryApiDependencies["diaryService"];
  webDiaryCommentService?: DiaryApiDependencies["diaryCommentService"];
  webSystemService?: SystemApiDependencies["systemService"];
  toyService?: ToyApiDependencies["toyService"];
  webGlobalSearchService?: GlobalSearchApiDependencies["globalSearchService"];
  webTodoService?: TodoApiDependencies["todoService"];
  webExportService?: ExportApiDependencies["exportService"];
  webImportService?: ImportApiDependencies["importService"];
  webUniverseService?: UniverseApiDependencies["universeService"];
  webMindService?: MindApiDependencies["mindService"];
  internalMindRecall?: Parameters<typeof createMindRecallRouter>[0];
  healthSyncService?: HealthSyncApiDependencies["healthSyncService"];
  databaseReadinessProbe?: () => Promise<unknown>;
  mcpSessionRegistry?: McpSessionRegistry;
  createMcpSessionServer?: McpSessionServerFactory;
};

export function createApp(
  dependencies: AppDependencies = {},
): express.Express {
  const app = express();
  const logger = dependencies.logger ?? createSafeLogger({ level: env.LOG_LEVEL });
  const observeMcpLifecycle = createMcpLifecycleObserver(logger);
  const config = requireOAuthConfig(env);
  if (
    dependencies.nativeLiveProduction
    && !config.NATIVE_LIVE_RELAY_AUTH_TOKEN
  ) {
    throw new Error(
      "Native Live production requires a dedicated relay credential.",
    );
  }
  const oauthAuthorizationServerConfig = getOAuthAuthorizationServerConfig(env);
  const mcpGovernance = getMcpGovernanceConfig(env);
  const mcpSessionRegistry = dependencies.mcpSessionRegistry ?? new McpSessionRegistry({
    idleTtlMs: mcpGovernance.idleTtlSeconds * 1_000,
    absoluteTtlMs: mcpGovernance.absoluteTtlSeconds * 1_000,
    maxPerUser: mcpGovernance.maxPerUser,
    maxTotal: mcpGovernance.maxTotal,
    observer: observeMcpLifecycle,
  });

  const databaseReadiness = dependencies.databaseReadinessProbe
    ? createDatabaseReadinessGate(
        dependencies.databaseReadinessProbe,
        {
          maxAttempts: RUNTIME_DATABASE_READINESS_MAX_ATTEMPTS,
          backoffMs: MIGRATION_READINESS_BACKOFF_MS,
          maxBackoffMs: MIGRATION_READINESS_MAX_BACKOFF_MS,
          onRetry: ({ attempt, maxAttempts, name, code }) => {
            logger.warn("database_readiness_retry", {
              attempt,
              maxAttempts,
              name,
              code,
            });
          },
        },
      )
    : undefined;

  const respondDatabaseUnavailable = (response: express.Response): void => {
    response.status(503).json({
      success: false,
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database is temporarily unavailable.",
      },
    });
  };

  const logDatabaseReadinessFailure = (error: unknown): void => {
    const { name, code } = safeErrorFingerprint(error);
    logger.error("database_readiness_failed", { name, code });
  };

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
    } catch (error) {
      logDatabaseReadinessFailure(error);
      respondDatabaseUnavailable(response);
    }
  };

  const verifyAccessToken =
    dependencies.verifyAccessToken ??
    createAuth0JwtVerifier({
      issuer: config.AUTH0_ISSUER,
      audience: config.AUTH0_AUDIENCE,
      jwksUri: config.AUTH0_JWKS_URI,
      requiredScope: config.AUTH0_REQUIRED_SCOPE,
    });

  const metadataHandler =
    createProtectedResourceMetadataHandler(
      config,
      oauthAuthorizationServerConfig
        ? { authorizationServers: [config.MCP_SERVER_URL, config.AUTH0_ISSUER] }
        : undefined,
    );

  const webApiConfig = getWebApiConfig(env);

  app.disable("x-powered-by");
  app.use(createHttpObservabilityMiddleware({ logger }));
  if (dependencies.nativeLiveAttachmentTransferStore) {
    app.use(
      "/api/v1/native-live/attachment-transfer",
      databaseReadinessMiddleware,
      createNativeLiveAttachmentTransferRouter(
        dependencies.nativeLiveAttachmentTransferStore,
      ),
    );
  }

  const defaultJsonParser = express.json({ limit: "1mb" });
  const mindRecallJsonParser = express.json({ limit: "4mb" });
  const nativeLiveRelayJsonParser = express.json({ limit: "8mb" });
  const nativeLiveSessionStoreJsonParser =
    express.json({ limit: "32mb" });
  app.use((request, response, next) => {
    const internalRelayToken =
      config.NATIVE_LIVE_RELAY_AUTH_TOKEN;
    const authenticatedInternal =
      Boolean(internalRelayToken)
      && request.header("authorization")
        === `Bearer ${internalRelayToken}`;
    const usesNativeLiveRelayParser =
      authenticatedInternal
      && (
        request.path === "/internal/native-live-relay"
        || request.path.startsWith(
          "/internal/native-live-relay/",
        )
      );
    const usesNativeLiveSessionStoreParser =
      authenticatedInternal
      && (
        request.path === "/internal/native-live-session-store"
        || request.path.startsWith(
          "/internal/native-live-session-store/",
        )
      );

    // The shared 256×2000 candidate plan can exceed 1 MB for CJK text.
    const usesMindRecallParser = authenticatedInternal && request.path === "/internal/mind/recall";
    const parser = usesMindRecallParser
      ? mindRecallJsonParser
      : usesNativeLiveSessionStoreParser
      ? nativeLiveSessionStoreJsonParser
      : usesNativeLiveRelayParser
        ? nativeLiveRelayJsonParser
        : defaultJsonParser;
    parser(request, response, next);
  });

  app.get("/health", (_request, response) => {
    response.json({
      success: true,
      data: {
        service: "leilei-os",
        status: "ok",
      },
    });
  });

  app.get("/ready", async (_request, response) => {
    if (!databaseReadiness) {
      logDatabaseReadinessFailure(
        Object.assign(new Error("Database readiness is not configured."), {
          name: "UNAVAILABLE",
          code: "UNCONFIGURED",
        }),
      );
      respondDatabaseUnavailable(response);
      return;
    }

    try {
      await databaseReadiness();
      response.json({
        success: true,
        data: {
          service: "leilei-os",
          status: "ready",
        },
      });
    } catch (error) {
      logDatabaseReadinessFailure(error);
      respondDatabaseUnavailable(response);
    }
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

  app.use(
    "/api/v1/health-sync",
    createHealthSyncAuthMiddleware(
      env.LEILEI_HEALTH_SYNC_KEY,
      env.LEILEI_HEALTH_SYNC_USER_ID,
    ),
    databaseReadinessMiddleware,
    createHealthSyncRouter({
      healthSyncService: dependencies.healthSyncService,
      userId: env.LEILEI_HEALTH_SYNC_USER_ID,
    }),
  );

  if (oauthAuthorizationServerConfig) {
    const metadataFetcher = createSecureMetadataFetcher({
      timeoutMs: oauthAuthorizationServerConfig.fetchTimeoutMs,
    });
    const clientRegistry = createClientRegistry({
      staticClients: oauthAuthorizationServerConfig.staticClients,
      trustedClientMetadataUrls:
        oauthAuthorizationServerConfig.trustedClientMetadataUrls,
      fetchMetadata: metadataFetcher.fetch,
    });
    app.use(
      createOAuthAuthorizationServer({
        issuer: config.MCP_SERVER_URL,
        resource: config.AUTH0_AUDIENCE,
        audience: config.AUTH0_AUDIENCE,
        requiredScope: config.AUTH0_REQUIRED_SCOPE,
        upstreamAuthorizationEndpoint: new URL("authorize", config.AUTH0_ISSUER).toString(),
        upstreamTokenEndpoint: new URL("oauth/token", config.AUTH0_ISSUER).toString(),
        upstreamClientId: oauthAuthorizationServerConfig.upstreamClientId,
        upstreamRedirectUri: oauthAuthorizationServerConfig.upstreamRedirectUri,
        registry: clientRegistry,
        fetchJwks: metadataFetcher.fetch,
        verifyAccessToken,
        allowedSubject: config.AUTH0_ALLOWED_SUBJECT,
        exchangeUpstreamCode: createAuth0CodeExchange({
          tokenEndpoint: new URL("oauth/token", config.AUTH0_ISSUER).toString(),
          timeoutMs: oauthAuthorizationServerConfig.fetchTimeoutMs,
        }),
      }),
    );
  }

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

    const webDiaryService = dependencies.webDiaryService;
    const webDiaryCommentService =
      dependencies.webDiaryCommentService;
    const webSystemService = dependencies.webSystemService;
    const toyService = dependencies.toyService;
    const webGlobalSearchService = dependencies.webGlobalSearchService;
    const webTodoService = dependencies.webTodoService;
    const webExportService = dependencies.webExportService;
    const webImportService = dependencies.webImportService;
    const webUniverseService = dependencies.webUniverseService;
    const webMindService = dependencies.webMindService;

    if (
      !webDiaryService ||
      !webSystemService ||
      !toyService ||
      !webGlobalSearchService ||
      !webTodoService ||
      !webExportService ||
      !webImportService
      || !webUniverseService
    ) {
      throw new Error("Web API services are not configured.");
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
        {
          onAuthFailure: (authFailure) => {
            logger.warn("auth_verification_failed", {
              surface: "web_api",
              authFailure,
            });
          },
        },
      ),
      databaseReadinessMiddleware,
      createWebApiRouter({
        diary: {
          diaryService: webDiaryService,
          ...(webDiaryCommentService
            ? { diaryCommentService: webDiaryCommentService }
            : {}),
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
        ...(webMindService
          ? { mind: { mindService: webMindService } }
          : {}),
        ...(dependencies.nativeLiveProduction
          ? {
              nativeLive:
                dependencies.nativeLiveProduction.web,
            }
          : {}),
      }),
    );
  }

  app.use(
    "/mcp",
    createOAuthMiddleware(config, verifyAccessToken, {
      onAuthFailure: (authFailure) => {
        logger.warn("auth_verification_failed", {
          surface: "mcp_public",
          authFailure,
        });
      },
    }),
    databaseReadinessMiddleware,
    createMcpRouter({
      namespace: "public",
      registry: mcpSessionRegistry,
      createSessionServer: dependencies.createMcpSessionServer,
      logger,
    }),
  );

  if (config.NATIVE_LIVE_RELAY_AUTH_TOKEN && dependencies.internalMindRecall) {
    app.use("/internal/mind",
      createInternalAuthMiddleware(config.NATIVE_LIVE_RELAY_AUTH_TOKEN, config.MCP_USER_ID),
      databaseReadinessMiddleware,
      createMindRecallRouter(dependencies.internalMindRecall),
    );
  }

  if (
    config.NATIVE_LIVE_RELAY_AUTH_TOKEN
    && dependencies.nativeLiveProduction
  ) {
    app.use(
      "/internal/native-live-session-store",
      createInternalAuthMiddleware(
        config.NATIVE_LIVE_RELAY_AUTH_TOKEN,
        config.MCP_USER_ID,
      ),
      databaseReadinessMiddleware,
      express.json({ limit: "32mb" }),
      createNativeLiveProviderSessionStoreInternalRouter({
        providerSessionStoreService:
          dependencies.nativeLiveProduction.internal
            .providerSessionStoreService,
        restoreNativeHistory: dependencies.nativeLiveProduction.internal.restoreNativeHistory,
        readNativeHistoryState: dependencies.nativeLiveProduction.internal.readNativeHistoryState,
        releaseNativeHistory: dependencies.nativeLiveProduction.internal.releaseNativeHistory,
        nativeHistoryAsset: dependencies.nativeLiveProduction.internal.nativeHistoryAsset,
        listNativeHistoryChoices: dependencies.nativeLiveProduction.internal.listNativeHistoryChoices,
      }),
    );
  }

  if (
    config.NATIVE_LIVE_RELAY_AUTH_TOKEN
    && dependencies.nativeLiveProduction
  ) {
    app.use(
      "/internal/native-live-mcp",
      createInternalAuthMiddleware(
        config.NATIVE_LIVE_RELAY_AUTH_TOKEN,
        config.MCP_USER_ID,
      ),
      databaseReadinessMiddleware,
      createMcpRouter({
        namespace: "internal",
        registry: mcpSessionRegistry,
        createSessionServer: dependencies.createMcpSessionServer,
        logger,
        allowStatelessPostRecovery: true,
      }),
    );
  }

  if (config.NATIVE_LIVE_RELAY_AUTH_TOKEN) {
    if (dependencies.nativeLiveProduction) {
      app.use(
        "/internal/native-live-relay",
        createInternalAuthMiddleware(
          config.NATIVE_LIVE_RELAY_AUTH_TOKEN,
          config.MCP_USER_ID,
        ),
        databaseReadinessMiddleware,
        createNativeLiveRelayInternalRouter({
          ...dependencies.nativeLiveProduction.internal,
          observeCompanionBackgroundOpportunity: (event) => {
            logger.info(
              "native_live_companion_background_opportunity",
              {
                outcome: event.outcome,
                reason: event.reason,
                maintenanceKindCount:
                  event.maintenanceKindCount,
                effectDeliveryScheduled:
                  event.effectDeliveryScheduled,
                proactivityScheduled:
                  event.proactivityScheduled,
                failureCount: event.failureCount,
              },
            );
          },
        }),
      );
    }
  }

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
        createSessionServer: dependencies.createMcpSessionServer,
        logger,
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
