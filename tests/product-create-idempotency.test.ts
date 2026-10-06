import assert from "node:assert/strict";
import test from "node:test";
import {
  hashProductCreateRequest,
  normalizeProductCreateIdempotencyKey,
  ProductCreateIdempotencyError,
} from "../src/domains/product-write/product-create-idempotency.js";

test("product create idempotency keys are normalized and bounded", () => {
  assert.equal(
    normalizeProductCreateIdempotencyKey(
      "  mind-create-0001  ",
    ),
    "mind-create-0001",
  );

  for (const value of [
    "",
    "short",
    "contains space 0001",
    "x".repeat(129),
  ]) {
    assert.throws(
      () => normalizeProductCreateIdempotencyKey(value),
      (error: unknown) =>
        error instanceof ProductCreateIdempotencyError
        && error.code === "INVALID_IDEMPOTENCY_KEY",
    );
  }
});

test("product create request fingerprints are canonical by object key order", () => {
  const left = hashProductCreateRequest({
    operation: "mind_manual_create",
    metadata: {
      beta: [true, null, 2],
      alpha: "one",
    },
  });
  const right = hashProductCreateRequest({
    metadata: {
      alpha: "one",
      beta: [true, null, 2],
    },
    operation: "mind_manual_create",
  });
  const changed = hashProductCreateRequest({
    operation: "mind_manual_create",
    metadata: {
      beta: [true, null, 3],
      alpha: "one",
    },
  });

  assert.equal(left, right);
  assert.notEqual(left, changed);
  assert.match(left, /^[0-9a-f]{64}$/);
});
