import type { RequestHandler } from "express";
import type { AppConfig } from "../config/env.js";
import { AccessTokenError, type AccessTokenVerifier } from "./jwt-verifier.js";

function createChallenge(
  config: AppConfig,
  error?: AccessTokenError,
): string {
  const metadataUrl = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    config.MCP_SERVER_URL,
  ).toString();
  const parameters = [
    'realm="leilei-os"',
    `resource_metadata="${metadataUrl}"`,
    `scope="${config.AUTH0_REQUIRED_SCOPE}"`,
  ];

  if (error) {
    parameters.push(`error="${error.kind}"`);
    parameters.push(`error_description="${error.message}"`);
  }

  return `Bearer ${parameters.join(", ")}`;
}

export function createOAuthMiddleware(
  config: AppConfig,
  verifyAccessToken: AccessTokenVerifier,
): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.header("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!token) {
      response.setHeader("WWW-Authenticate", createChallenge(config));
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "OAuth authentication is required.",
        },
      });
      return;
    }

    try {
      const principal = await verifyAccessToken(token);
      if (principal.subject !== config.AUTH0_ALLOWED_SUBJECT) {
        throw new AccessTokenError(
          "The token subject is not authorized.",
          "invalid_token",
        );
      }

      request.oauthPrincipal = principal;
      request.mcpUserId = config.MCP_USER_ID;
      next();
    } catch (error) {
      const accessTokenError =
        error instanceof AccessTokenError
          ? error
          : new AccessTokenError("The access token is invalid.", "invalid_token");
      const status = accessTokenError.kind === "insufficient_scope" ? 403 : 401;

      response.setHeader(
        "WWW-Authenticate",
        createChallenge(config, accessTokenError),
      );
      response.status(status).json({
        success: false,
        error: {
          code:
            accessTokenError.kind === "insufficient_scope"
              ? "INSUFFICIENT_SCOPE"
              : "UNAUTHORIZED",
          message: accessTokenError.message,
        },
      });
    }
  };
}

