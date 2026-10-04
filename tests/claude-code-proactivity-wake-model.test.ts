import assert from "node:assert/strict";
import test from "node:test";
import {
  parseClaudeCodeProactivityWakeOutput,
} from "../src/domains/runtime/proactivity/claude-code-proactivity-wake-model.js";

test("Proactivity wake parser accepts only quiet, reflect, or bounded contact candidate", () => {
  assert.deepEqual(
    parseClaudeCodeProactivityWakeOutput('{"outcome":"quiet"}'),
    { outcome: "quiet" },
  );
  assert.deepEqual(
    parseClaudeCodeProactivityWakeOutput('{"outcome":"reflect"}'),
    { outcome: "reflect" },
  );
  assert.deepEqual(
    parseClaudeCodeProactivityWakeOutput('```json\n{"outcome":"contact_candidate","text":"  想起你之前提过的那件事。  "}\n```'),
    {
      outcome: "contact_candidate",
      text: "想起你之前提过的那件事。",
    },
  );

  assert.throws(
    () => parseClaudeCodeProactivityWakeOutput(
      '{"outcome":"quiet","text":"no"}',
    ),
    /unexpected fields/,
  );
  assert.throws(
    () => parseClaudeCodeProactivityWakeOutput(
      '{"outcome":"contact_candidate","text":"   "}',
    ),
    /empty or too long/,
  );
});
