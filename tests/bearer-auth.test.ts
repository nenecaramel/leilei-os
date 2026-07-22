import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { optionalBearerAuth } from "../src/auth/bearer-auth.js";

type AuthResult = {
  nextCalled: boolean;
  statusCode?: number;
  body?: unknown;
};

function invokeAuth(
  expectedToken: string | undefined,
  allowUnauthenticated: boolean,
  authorization?: string,
): AuthResult {
  const result: AuthResult = { nextCalled: false };
  const request = {
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? authorization : undefined,
  } as Request;
  const response = {
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

  optionalBearerAuth(expectedToken, allowUnauthenticated)(
    request,
    response,
    next,
  );

  return result;
}

test("keeps bearer authentication enabled by default", () => {
  const result = invokeAuth("a-secure-test-token", false);

  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});

test("accepts the configured bearer token when bypass is disabled", () => {
  const result = invokeAuth(
    "a-secure-test-token",
    false,
    "Bearer a-secure-test-token",
  );

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, undefined);
});

test("allows a tokenless request only when the explicit bypass is enabled", () => {
  const result = invokeAuth("a-secure-test-token", true);

  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, undefined);
});

test("restores bearer rejection when the bypass is switched off", () => {
  const enabled = invokeAuth("a-secure-test-token", true);
  const restored = invokeAuth("a-secure-test-token", false);

  assert.equal(enabled.nextCalled, true);
  assert.equal(restored.nextCalled, false);
  assert.equal(restored.statusCode, 401);
});
