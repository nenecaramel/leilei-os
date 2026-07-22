import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.js";

export function createProtectedResourceMetadataHandler(
  config: AppConfig,
): RequestHandler {
  return (_request, response) => {
    response.setHeader("Cache-Control", "public, max-age=300");
    response.json({
      resource: config.AUTH0_AUDIENCE,
      authorization_servers: [config.AUTH0_ISSUER],
      scopes_supported: [config.AUTH0_REQUIRED_SCOPE],
      bearer_methods_supported: ["header"],
      resource_documentation: new URL("/oauth", config.MCP_SERVER_URL).toString(),
    });
  };
}

