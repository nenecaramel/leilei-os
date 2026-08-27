import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { WebApiConfig } from "../src/config/env.js";
import { AccessTokenError } from "../src/auth/jwt-verifier.js";
import { createWebApiAuthMiddleware } from "../src/web-api/web-api-auth.js";
import { createWebApiCorsMiddleware } from "../src/web-api/web-api-cors.js";

const config = {
  MCP_USER_ID: "11111111-1111-4111-8111-111111111111",
  AUTH0_ISSUER: "https://leilei-test.auth0.com/",
  AUTH0_JWKS_URI: "https://leilei-test.auth0.com/.well-known/jwks.json",
  AUTH0_ALLOWED_SUBJECT: "auth0|leilei",
  WEB_APP_ORIGIN: "https://leilei-web.example.com",
  WEB_AUTH0_AUDIENCE: "https://leilei.example.com/api",
  WEB_AUTH0_REQUIRED_SCOPE: "leilei:web",
} satisfies WebApiConfig;

function responseRecorder() {
  const result: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
  const response = {
    setHeader: (name: string, value: string) => {
      result.headers[name.toLowerCase()] = value;
      return response;
    },
    status: (status: number) => {
      result.status = status;
      return response;
    },
    json: (body: unknown) => {
      result.body = body;
      return response;
    },
    sendStatus: (status: number) => {
      result.status = status;
      return response;
    },
  } as unknown as Response;
  return { result, response };
}

test("maps the allowed Web token subject to the server-owned user id", async () => {
  const request = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? "Bearer web-token" : undefined,
  } as Request;
  const { response } = responseRecorder();
  let nextCalled = false;
  const middleware = createWebApiAuthMiddleware(config, async () => ({
    subject: config.AUTH0_ALLOWED_SUBJECT,
    issuer: config.AUTH0_ISSUER,
    audience: [config.WEB_AUTH0_AUDIENCE],
    scopes: [config.WEB_AUTH0_REQUIRED_SCOPE],
  }));

  await middleware(request, response, (() => {
    nextCalled = true;
  }) as NextFunction);

  assert.equal(nextCalled, true);
  assert.equal(request.webUserId, config.MCP_USER_ID);
  assert.equal(request.mcpUserId, undefined);
});

test("rejects missing, wrong-subject and insufficient-scope Web tokens", async () => {
  const missingRequest = { header: () => undefined } as unknown as Request;
  const missingResponse = responseRecorder();
  await createWebApiAuthMiddleware(config, async () => {
    throw new Error("must not be called");
  })(missingRequest, missingResponse.response, (() => {}) as NextFunction);
  assert.equal(missingResponse.result.status, 401);
  assert.match(missingResponse.result.headers["www-authenticate"] ?? "", /leilei:web/u);

  const wrongSubjectRequest = {
    header: () => "Bearer web-token",
  } as unknown as Request;
  const wrongSubjectResponse = responseRecorder();
  let wrongSubjectReason: string | undefined;
  await createWebApiAuthMiddleware(
    config,
    async () => ({
      subject: "auth0|someone-else",
      issuer: config.AUTH0_ISSUER,
      audience: [config.WEB_AUTH0_AUDIENCE],
      scopes: [config.WEB_AUTH0_REQUIRED_SCOPE],
    }),
    { onAuthFailure: (reason) => { wrongSubjectReason = reason; } },
  )(wrongSubjectRequest, wrongSubjectResponse.response, (() => {}) as NextFunction);
  assert.equal(wrongSubjectResponse.result.status, 401);
  assert.equal(wrongSubjectReason, "subject_not_allowed");

  const scopeRequest = { header: () => "Bearer web-token" } as unknown as Request;
  const scopeResponse = responseRecorder();
  await createWebApiAuthMiddleware(config, async () => {
    throw new AccessTokenError("Missing Web scope.", "insufficient_scope");
  })(scopeRequest, scopeResponse.response, (() => {}) as NextFunction);
  assert.equal(scopeResponse.result.status, 403);
});

test("Web auth verification diagnostics are non-fatal and preserve the 401 contract", async () => {
  const request = { header: () => "Bearer web-token" } as unknown as Request;
  const response = responseRecorder();
  const reasons: string[] = [];
  await createWebApiAuthMiddleware(
    config,
    async () => {
      throw new AccessTokenError(
        "The access token is invalid.",
        "invalid_token",
        "jwks_unavailable",
      );
    },
    { onAuthFailure: (reason) => reasons.push(reason) },
  )(request, response.response, (() => {}) as NextFunction);
  assert.deepEqual(reasons, ["jwks_unavailable"]);
  assert.equal(response.result.status, 401);

  const callbackThrowing = responseRecorder();
  await createWebApiAuthMiddleware(
    config,
    async () => { throw new Error("private verifier detail"); },
    { onAuthFailure: () => { throw new Error("observer failure"); } },
  )(request, callbackThrowing.response, (() => {}) as NextFunction);
  assert.equal(callbackThrowing.result.status, 401);
});

test("allows CORS only from the configured Web origin", () => {
  const allowedRequest = {
    method: "OPTIONS",
    header: () => config.WEB_APP_ORIGIN,
  } as unknown as Request;
  const allowedResponse = responseRecorder();
  createWebApiCorsMiddleware(config.WEB_APP_ORIGIN)(
    allowedRequest,
    allowedResponse.response,
    (() => {}) as NextFunction,
  );
  assert.equal(allowedResponse.result.status, 204);
  assert.equal(
    allowedResponse.result.headers["access-control-allow-origin"],
    config.WEB_APP_ORIGIN,
  );
  assert.match(
    allowedResponse.result.headers["access-control-allow-methods"] ?? "",
    /(?:^|,)PUT(?:,|$)/,
  );

  const deniedRequest = {
    method: "OPTIONS",
    header: () => "https://attacker.example.com",
  } as unknown as Request;
  const deniedResponse = responseRecorder();
  createWebApiCorsMiddleware(config.WEB_APP_ORIGIN)(
    deniedRequest,
    deniedResponse.response,
    (() => {}) as NextFunction,
  );
  assert.equal(deniedResponse.result.status, 403);
});
