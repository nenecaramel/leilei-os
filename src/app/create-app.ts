import express from "express";
import { createInternalAuthMiddleware } from "../auth/internal-auth.js";
import {
  createAuth0JwtVerifier,
  type AccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { createOAuthMiddleware } from "../auth/oauth-middleware.js";
import { env, requireOAuthConfig } from "../config/env.js";
import { getWebApiConfig } from "../config/env.js";
import { createDatabase } from "../database/client.js";
import { createMcpRouter } from "../mcp/server/router.js";
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

import { DrizzleHealthRepository } from "../domains/health/health-repository.js";
import { HealthService } from "../domains/health/health-service.js";
import type { HealthApiDependencies } from "../web-api/health-router.js";

export type AppDependencies = {
  verifyAccessToken?: AccessTokenVerifier;
  verifyWebAccessToken?: AccessTokenVerifier;
  webMemoryService?: MemoryApiDependencies["memoryService"];
  webDiaryService?: DiaryApiDependencies["diaryService"];
  webHealthService?: HealthApiDependencies["healthService"];
};

export function createApp(
  dependencies: AppDependencies = {},
): express.Express {
  const app = express();
  const config = requireOAuthConfig(env);

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
  app.use(express.json({ limit: "256kb" }));

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

    let webHealthService =
      dependencies.webHealthService;

    if (
      !webMemoryService ||
      !webDiaryService ||
      !webHealthService
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

      if (!webHealthService) {
        webHealthService = new HealthService(
          new DrizzleHealthRepository(db),
        );
      }
    }

    if (
      !webMemoryService ||
      !webDiaryService ||
      !webHealthService
    ) {
      throw new Error(
        "Web API services are not configured.",
      );
    }

    app.use(
      "/api/v1",
      createWebApiCorsMiddleware(
        webApiConfig.WEB_APP_ORIGIN,
      ),
      createWebApiAuthMiddleware(
        webApiConfig,
        verifyWebAccessToken,
      ),
      createWebApiRouter({
        memory: {
          memoryService: webMemoryService,
        },
        diary: {
          diaryService: webDiaryService,
        },
        health: {
          healthService: webHealthService,
        },
      }),
    );
  }

  app.use(
    "/mcp",
    createOAuthMiddleware(config, verifyAccessToken),
    createMcpRouter(),
  );

  if (config.MCP_AUTH_TOKEN) {
    app.use(
      "/internal/mcp",
      createInternalAuthMiddleware(
        config.MCP_AUTH_TOKEN,
        config.MCP_USER_ID,
      ),
      createMcpRouter(),
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