import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import type { AuthenticatedPrincipal } from "./auth-types.js";

export type JwtVerifierConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
  requiredScope: string;
};

export class AccessTokenError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid_token" | "insufficient_scope",
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

export type AccessTokenVerifier = (
  token: string,
) => Promise<AuthenticatedPrincipal>;

function parseScopes(payload: JWTPayload): string[] {
  if (typeof payload.scope === "string") {
    return payload.scope.split(/\s+/u).filter(Boolean);
  }

  if (Array.isArray(payload.permissions)) {
    return payload.permissions.filter(
      (permission): permission is string => typeof permission === "string",
    );
  }

  return [];
}

export function createJwtVerifier(
  config: JwtVerifierConfig,
  keyResolver: JWTVerifyGetKey,
): AccessTokenVerifier {
  return async (token) => {
    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, keyResolver, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ["RS256"],
      });
      payload = verified.payload;
    } catch {
      throw new AccessTokenError("The access token is invalid.", "invalid_token");
    }

    if (!payload.sub) {
      throw new AccessTokenError(
        "The access token subject is missing.",
        "invalid_token",
      );
    }

    const scopes = parseScopes(payload);
    if (!scopes.includes(config.requiredScope)) {
      throw new AccessTokenError(
        "The access token does not grant the required scope.",
        "insufficient_scope",
      );
    }

    const audience = Array.isArray(payload.aud)
      ? payload.aud
      : payload.aud
        ? [payload.aud]
        : [];

    return {
      subject: payload.sub,
      issuer: config.issuer,
      audience,
      scopes,
    };
  };
}

export function createAuth0JwtVerifier(
  config: JwtVerifierConfig,
): AccessTokenVerifier {
  return createJwtVerifier(
    config,
    createRemoteJWKSet(new URL(config.jwksUri)),
  );
}
