import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalE5ProviderError,
  parseEmbeddingMatrix,
} from "../src/domains/runtime/breath/local-e5-embedding.js";

test("local E5 embedding parser accepts a normalized matrix shape", () => {
  assert.deepEqual(
    parseEmbeddingMatrix([[0.6, 0.8], [1, 0]], 2),
    [[0.6, 0.8], [1, 0]],
  );
});

test("local E5 embedding parser rejects row-count and dimension mismatch", () => {
  assert.throws(
    () => parseEmbeddingMatrix([[1, 0]], 2),
    (error: unknown) =>
      error instanceof LocalE5ProviderError
      && error.code === "INVALID_EMBEDDING_OUTPUT",
  );
  assert.throws(
    () => parseEmbeddingMatrix([[1, 0], [1]], 2),
    (error: unknown) =>
      error instanceof LocalE5ProviderError
      && error.code === "INVALID_EMBEDDING_OUTPUT",
  );
});

test("local E5 provider can be configured to use the CPU backend", async () => {
  const source = await import("../src/domains/runtime/breath/local-e5-embedding.js");
  const scorer = new source.LocalE5BreathSemanticScorer({
    device: "cpu",
  });
  assert.ok(scorer);
});
