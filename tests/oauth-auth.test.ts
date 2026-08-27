import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { createInternalAuthMiddleware } from "../src/auth/internal-auth.js";
import {
  AccessTokenError,
  classifyAuthFailure,
  createJwtVerifier,
} from "../src/auth/jwt-verifier.js";
import { createOAuthMiddleware } from "../src/auth/oauth-middleware.js";
import type { AppConfig } from "../src/config/env.js";
import { createProtectedResourceMetadataHandler } from "../src/oauth/protected-resource-metadata.js";

const config = {
  PORT: 3000,
  HOST: "127.0.0.1",
  LOG_LEVEL: "error",
  MCP_USER_ID: "11111111-1111-4111-8111-111111111111",
  MCP_SERVER_URL: "https://leilei.example.com",
  AUTH0_ISSUER: "https://leilei-test.auth0.com/",
  AUTH0_AUDIENCE: "https://leilei.example.com/mcp",
  AUTH0_JWKS_URI: "https://leilei-test.auth0.com/.well-known/jwks.json",
  AUTH0_REQUIRED_SCOPE: "leilei:access",
  AUTH0_ALLOWED_SUBJECT: "auth0|leilei",
} satisfies AppConfig;

type MiddlewareResult = {
  nextCalled: boolean;
  statusCode?: number;
  body?: unknown;
  headers: Record<string, string>;
  request: Request;
};

async function invokeMiddleware(
  middleware: ReturnType<typeof createOAuthMiddleware>,
  authorization?: string,
): Promise<MiddlewareResult> {
  const result: MiddlewareResult = {
    nextCalled: false,
    headers: {},
    request: {} as Request,
  };
  result.request = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  } as Request;
  const response = {
    setHeader: (name: string, value: string) => {
      result.headers[name.toLowerCase()] = value;
      return response;
    },
    status: (statusCode: number) => {
      result.statusCode = statusCode;
      return response;
    },
    json: (body: unknown) => {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  const next = (() => {
    result.nextCalled = true;
  }) as NextFunction;

  await middleware(result.request, response, next);
  return result;
}

test("verifies issuer, audience, signature and required scope", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "oauth-test-key";
  publicJwk.alg = "RS256";
  const verifier = createJwtVerifier(
    {
      issuer: config.AUTH0_ISSUER,
      audience: config.AUTH0_AUDIENCE,
      jwksUri: config.AUTH0_JWKS_URI,
      requiredScope: config.AUTH0_REQUIRED_SCOPE,
    },
    createLocalJWKSet({ keys: [publicJwk] }),
  );
  const issue = (scope: string) =>
    new SignJWT({ scope })
      .setProtectedHeader({ alg: "RS256", kid: "oauth-test-key" })
      .setIssuer(config.AUTH0_ISSUER)
      .setAudience(config.AUTH0_AUDIENCE)
      .setSubject(config.AUTH0_ALLOWED_SUBJECT)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  const principal = await verifier(await issue(config.AUTH0_REQUIRED_SCOPE));
  assert.equal(principal.subject, config.AUTH0_ALLOWED_SUBJECT);
  assert.deepEqual(principal.scopes, [config.AUTH0_REQUIRED_SCOPE]);
  await assert.rejects(
    verifier(await issue("openid profile")),
    (error: unknown) =>
      error instanceof AccessTokenError &&
      error.kind === "insufficient_scope" &&
      error.diagnosticReason === "scope_missing",
  );
});

test("classifies stable verifier failure codes without inspecting private messages", () => {
  assert.equal(
    classifyAuthFailure(Object.assign(new Error("secret"), { code: "ERR_JWT_EXPIRED" })),
    "token_expired",
  );
  assert.equal(
    classifyAuthFailure(Object.assign(new Error("secret"), { code: "ERR_JWKS_TIMEOUT" })),
    "jwks_unavailable",
  );
  assert.equal(
    classifyAuthFailure(Object.assign(new Error("secret"), { code: "ERR_JWS_INVALID" })),
    "signature_or_claim_invalid",
  );
  assert.equal(classifyAuthFailure(new Error("secret")), "verification_unknown");
});

test("auth verification callbacks receive internal reasons and cannot alter public behavior", async () => {
  const reasons: string[] = [];
  const result = await invokeMiddleware(
    createOAuthMiddleware(
      config,
      async () => {
        throw Object.assign(new Error("private verifier detail"), {
          code: "ERR_JWKS_TIMEOUT",
        });
      },
      { onAuthFailure: (reason) => reasons.push(reason) },
    ),
    "Bearer access-token",
  );
  assert.deepEqual(reasons, ["jwks_unavailable"]);
  assert.equal(result.statusCode, 401);
  assert.match(result.headers["www-authenticate"] ?? "", /error="invalid_token"/u);

  const callbackThrowing = await invokeMiddleware(
    createOAuthMiddleware(
      config,
      async () => {
        throw new Error("private verifier detail");
      },
      { onAuthFailure: () => { throw new Error("observer failure"); } },
    ),
    "Bearer access-token",
  );
  assert.equal(callbackThrowing.statusCode, 401);
});

test("returns OAuth metadata challenge when the public endpoint has no token", async () => {
  const result = await invokeMiddleware(
    createOAuthMiddleware(config, async () => {
      throw new Error("must not be called");
    }),
  );

  assert.equal(result.statusCode, 401);
  assert.match(result.headers["www-authenticate"] ?? "", /^Bearer /u);
  assert.match(
    result.headers["www-authenticate"] ?? "",
    /resource_metadata="https:\/\/leilei\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/u,
  );
});

test("maps only the allowed Auth0 subject to MCP_USER_ID", async () => {
  const allowed = await invokeMiddleware(
    createOAuthMiddleware(config, async () => ({
      subject: config.AUTH0_ALLOWED_SUBJECT,
      issuer: config.AUTH0_ISSUER,
      audience: [config.AUTH0_AUDIENCE],
      scopes: [config.AUTH0_REQUIRED_SCOPE],
    })),
    "Bearer access-token",
  );
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.request.mcpUserId, config.MCP_USER_ID);

  let deniedReason: string | undefined;
  const denied = await invokeMiddleware(
    createOAuthMiddleware(
      config,
      async () => ({
        subject: "auth0|another-user",
        issuer: config.AUTH0_ISSUER,
        audience: [config.AUTH0_AUDIENCE],
        scopes: [config.AUTH0_REQUIRED_SCOPE],
      }),
      { onAuthFailure: (reason) => { deniedReason = reason; } },
    ),
    "Bearer access-token",
  );
  assert.equal(denied.nextCalled, false);
  assert.equal(denied.statusCode, 401);
  assert.equal(deniedReason, "subject_not_allowed");
});

test("publishes protected resource metadata without internal credentials", () => {
  let body: unknown;
  const response = {
    setHeader: () => response,
    json: (value: unknown) => {
      body = value;
      return response;
    },
  } as unknown as Response;
  createProtectedResourceMetadataHandler(config)({} as Request, response, (() => {}) as NextFunction);

  assert.deepEqual(body, {
    resource: config.AUTH0_AUDIENCE,
    authorization_servers: [config.AUTH0_ISSUER],
    scopes_supported: [config.AUTH0_REQUIRED_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://leilei.example.com/oauth",
  });
});

test("keeps MCP_AUTH_TOKEN valid only for the internal middleware", () => {
  const middleware = createInternalAuthMiddleware(
    "a-long-internal-test-token",
    config.MCP_USER_ID,
  );
  const result = { nextCalled: false, statusCode: undefined as number | undefined };
  const request = {
    header: () => "Bearer a-long-internal-test-token",
  } as unknown as Request;
  const response = {
    status: (statusCode: number) => {
      result.statusCode = statusCode;
      return response;
    },
    json: () => response,
  } as unknown as Response;

  middleware(request, response, (() => {
    result.nextCalled = true;
  }) as NextFunction);
  assert.equal(result.nextCalled, true);
  assert.equal(request.mcpUserId, config.MCP_USER_ID);
});
