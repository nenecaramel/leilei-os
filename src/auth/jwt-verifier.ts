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

export type AuthFailureReason =
  | "token_expired"
  | "signature_or_claim_invalid"
  | "jwks_unavailable"
  | "scope_missing"
  | "subject_not_allowed"
  | "verification_unknown";

export class AccessTokenError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid_token" | "insufficient_scope",
    readonly diagnosticReason: AuthFailureReason =
      kind === "insufficient_scope" ? "scope_missing" : "signature_or_claim_invalid",
  ) {
    super(message);
    this.name = "AccessTokenError";
  }
}

const JWKS_UNAVAILABLE_CODES = new Set(["ERR_JWKS_TIMEOUT"]);
const SIGNATURE_OR_CLAIM_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JWT_INVALID",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

export function classifyAuthFailure(error: unknown): AuthFailureReason {
  let code: unknown;
  if (typeof error === "object" && error !== null && "code" in error) {
    code = (error as { code?: unknown }).code;
  }
  if (typeof code !== "string") return "verification_unknown";
  const normalizedCode = code.toUpperCase();
  if (normalizedCode === "ERR_JWT_EXPIRED") return "token_expired";
  if (JWKS_UNAVAILABLE_CODES.has(normalizedCode)) return "jwks_unavailable";
  if (SIGNATURE_OR_CLAIM_CODES.has(normalizedCode)) return "signature_or_claim_invalid";
  return "verification_unknown";
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
    } catch (error) {
      throw new AccessTokenError(
        "The access token is invalid.",
        "invalid_token",
        classifyAuthFailure(error),
      );
    }

    if (!payload.sub) {
      throw new AccessTokenError(
        "The access token subject is missing.",
        "invalid_token",
        "signature_or_claim_invalid",
      );
    }

    const scopes = parseScopes(payload);
    if (!scopes.includes(config.requiredScope)) {
      throw new AccessTokenError(
        "The access token does not grant the required scope.",
        "insufficient_scope",
        "scope_missing",
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
