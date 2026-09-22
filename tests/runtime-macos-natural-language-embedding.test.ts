import assert from "node:assert/strict";
import test from "node:test";
import {
  MacOSNaturalLanguageEmbeddingError,
  parseMacOSNaturalLanguageEmbeddingOutput,
} from "../src/domains/runtime/macos-natural-language-embedding.js";

test("macOS embedding adapter parses bounded state scores", () => {
  const scores = parseMacOSNaturalLanguageEmbeddingOutput(
    JSON.stringify({
      language: "zh-Hans",
      revision: 1,
      scores: [
        { stateId: "m1", score: 0.91 },
        { stateId: "m2", score: 0.12 },
      ],
    }),
    new Set(["m1", "m2"]),
  );

  assert.equal(scores.get("m1"), 0.91);
  assert.equal(scores.get("m2"), 0.12);
});

test("macOS embedding adapter rejects unknown ids and out-of-range scores", () => {
  assert.throws(
    () =>
      parseMacOSNaturalLanguageEmbeddingOutput(
        JSON.stringify({
          scores: [{ stateId: "other", score: 0.5 }],
        }),
        new Set(["m1"]),
      ),
    (error: unknown) =>
      error instanceof MacOSNaturalLanguageEmbeddingError
      && error.code === "INVALID_HELPER_OUTPUT",
  );

  assert.throws(
    () =>
      parseMacOSNaturalLanguageEmbeddingOutput(
        JSON.stringify({
          scores: [{ stateId: "m1", score: 1.5 }],
        }),
        new Set(["m1"]),
      ),
    (error: unknown) =>
      error instanceof MacOSNaturalLanguageEmbeddingError
      && error.code === "INVALID_HELPER_OUTPUT",
  );
});
