import assert from "node:assert/strict";
import { MacOSNaturalLanguageBreathSemanticScorer } from "../src/domains/runtime/macos-natural-language-embedding.js";

const scorer = new MacOSNaturalLanguageBreathSemanticScorer({
  language: "zh-Hans",
});

const scores = await scorer.score({
  query: "我一个人去韩国旅行的那次经历",
  candidates: [
    {
      stateId: "related",
      kind: "memory",
      text: "那趟独自去韩国旅行让我第一次觉得自己真的长大了",
    },
    {
      stateId: "unrelated",
      kind: "memory",
      text: "我们把 PostgreSQL 的 migration 和测试都跑通了",
    },
  ],
});

const related = scores.get("related");
const unrelated = scores.get("unrelated");
assert.equal(typeof related, "number");
assert.equal(typeof unrelated, "number");
assert.ok(related! > unrelated!, "related memory must score above unrelated memory");

process.stdout.write(
  JSON.stringify({
    status: "accepted",
    provider: "macos_natural_language",
    language: "zh-Hans",
    related,
    unrelated,
  }, null, 2) + "\n",
);
