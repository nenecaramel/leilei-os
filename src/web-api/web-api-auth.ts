import type { RequestHandler } from "express";
import type { WebApiConfig } from "../config/env.js";
import {
  AccessTokenError,
  type AccessTokenVerifier,
  type AuthFailureReason,
} from "../auth/jwt-verifier.js";
import { mapWebPrincipalToUserId } from "./user-identity-mapper.js";

function challenge(config: WebApiConfig, error?: AccessTokenError): string {
  const parts = [
    'realm="leilei-os-web-api"',
    `scope="${config.WEB_AUTH0_REQUIRED_SCOPE}"`,
  ];

  if (error) {
    parts.push(`error="${error.kind}"`);
  }

  return `Bearer ${parts.join(", ")}`;
}

export function createWebApiAuthMiddleware(
  config: WebApiConfig,
  verifyAccessToken: AccessTokenVerifier,
  options: { onAuthFailure?: (reason: AuthFailureReason) => void } = {},
): RequestHandler {
  return async (request, response, next) => {

    // CORS preflight 不需要 token
    if (request.method === "OPTIONS") {
      next();
      return;
    }

    const authorization = request.header("authorization");

    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!token) {
      response.setHeader("WWW-Authenticate", challenge(config));
      response.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Web API authentication is required.",
        },
      });
      return;
    }

    try {
      const principal = await verifyAccessToken(token);

      request.oauthPrincipal = principal;
      request.webUserId = mapWebPrincipalToUserId(config, principal);

      next();
    } catch (error) {
      const accessTokenError =
        error instanceof AccessTokenError
          ? error
          : new AccessTokenError(
              "The access token is invalid.",
              "invalid_token",
              "verification_unknown",
            );

      try {
        options.onAuthFailure?.(accessTokenError.diagnosticReason);
      } catch {
        // Authentication diagnostics must never alter the public auth contract.
      }

      const status =
        accessTokenError.kind === "insufficient_scope"
          ? 403
          : 401;

      response.setHeader(
        "WWW-Authenticate",
        challenge(config, accessTokenError),
      );

      response.status(status).json({
        success: false,
        error: {
          code:
            status === 403
              ? "INSUFFICIENT_SCOPE"
              : "UNAUTHORIZED",
          message: accessTokenError.message,
        },
      });
    }
  };
}
