import express from "express";
import { createInternalAuthMiddleware } from "../auth/internal-auth.js";
import {
  createAuth0JwtVerifier,
  type AccessTokenVerifier,
} from "../auth/jwt-verifier.js";
import { createOAuthMiddleware } from "../auth/oauth-middleware.js";
import { env, requireOAuthConfig } from "../config/env.js";
import { createMcpRouter } from "../mcp/server/router.js";
import { createProtectedResourceMetadataHandler } from "../oauth/protected-resource-metadata.js";

export type AppDependencies = {
  verifyAccessToken?: AccessTokenVerifier;
};

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();
  const config = requireOAuthConfig(env);
  const verifyAccessToken =
    dependencies.verifyAccessToken ?? createAuth0JwtVerifier(config);
  const metadataHandler = createProtectedResourceMetadataHandler(config);

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

  app.get("/.well-known/oauth-protected-resource", metadataHandler);
  app.get("/.well-known/oauth-protected-resource/mcp", metadataHandler);

  app.get("/oauth", (_request, response) => {
    response
      .type("text/plain")
      .send("Leilei OS uses OAuth 2.1 to authorize access to its public MCP endpoint.");
  });

  app.use(
    "/mcp",
    createOAuthMiddleware(config, verifyAccessToken),
    createMcpRouter(),
  );

  if (config.MCP_AUTH_TOKEN) {
    app.use(
      "/internal/mcp",
      createInternalAuthMiddleware(config.MCP_AUTH_TOKEN, config.MCP_USER_ID),
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
