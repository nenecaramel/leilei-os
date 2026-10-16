import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalE5BreathSemanticScorer,
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

test("E5 reuses unchanged passage embeddings across prompts and invalidates edited text", async () => {
  const calls: string[][] = [];
  const scorer = new LocalE5BreathSemanticScorer();
  const extractor = async (texts: string[]) => {
    calls.push([...texts]);
    return {tolist: () => texts.map(text => text.includes("banana") ? [0, 1] : [1, 0])};
  };
  (scorer as unknown as {extractorPromise: Promise<typeof extractor>}).extractorPromise = Promise.resolve(extractor);

  const first = await scorer.score({
    query: "fruit",
    candidates: [
      {stateId: "m1", kind: "memory", text: "apple"},
      {stateId: "m2", kind: "memory", text: "apple"},
    ],
  });
  const second = await scorer.score({
    query: "dessert",
    candidates: [
      {stateId: "m3", kind: "memory", text: "apple"},
      {stateId: "m4", kind: "memory", text: "banana"},
    ],
  });
  const edited = await scorer.score({
    query: "fruit",
    candidates: [{stateId: "m1", kind: "memory", text: "apple revised"}],
  });

  assert.equal(first.get("m1"), first.get("m2"));
  assert.equal(second.get("m3"), 1);
  assert.equal(second.get("m4"), 0);
  assert.equal(edited.get("m1"), 1);
  assert.deepEqual(calls, [
    ["query: fruit", "passage: apple"],
    ["query: dessert", "passage: banana"],
    ["query: fruit", "passage: apple revised"],
  ]);
});

test("E5 stops scheduling additional passage batches when the requesting socket closes", async () => {
  const controller = new AbortController();
  const calls: string[][] = [];
  const scorer = new LocalE5BreathSemanticScorer();
  const extractor = async (texts: string[]) => {
    calls.push([...texts]);
    controller.abort();
    return {tolist: () => texts.map(() => [1, 0])};
  };
  (scorer as unknown as {extractorPromise: Promise<typeof extractor>}).extractorPromise = Promise.resolve(extractor);

  await assert.rejects(
    () => scorer.score({
      query: "abort",
      candidates: Array.from({length: 70}, (_, i) => ({
        stateId: `m-${i}`, kind: "memory" as const, text: `candidate ${i}`,
      })),
      signal: controller.signal,
    }),
    /aborted/i,
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.length <= 33);
});
