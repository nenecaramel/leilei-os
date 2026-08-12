import assert from "node:assert/strict";
import test from "node:test";
import { WebApiError } from "../web/src/api/web-api-error.js";

test("WebApiError exposes safe status and server error code", () => {
  const error = new WebApiError(409, "TODO_PAPER_CONFLICT", "Todo paper changed on another device.");
  assert.equal(error.status, 409);
  assert.equal(error.code, "TODO_PAPER_CONFLICT");
  assert.equal(error.message, "Todo paper changed on another device.");
  assert.ok(error instanceof Error);
});
