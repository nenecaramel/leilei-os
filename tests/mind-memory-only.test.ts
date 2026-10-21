import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { parseMindWriteIntents } from "../src/domains/runtime/mind/mind-intent-parser.js";
import { parseMindSemanticActions } from "../src/domains/runtime/mind/mind-semantic-action.js";
import { validateSubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

const input = {id: "memory-a", userId: "u", subjectId: "claude", text: "We met again and I felt relieved", source: {origin: "manual" as const, occurredAt: "2026-01-01T01:02:03Z", note: "keep"}};
test("shared writer rejects every retired kind even from untyped callers", () => {
  for (const kind of ["thought", "feel", "drive"]) {
    assert.throws(() => createMindState({...input, kind} as never), /kind/i);
  }
  const memory = createMindState({...input, kind: "memory"});
  assert.equal(memory.kind, "memory");
  assert.equal(memory.envelope.authority, "user_asserted");
  assert.equal(memory.envelope.status.settlementStatus, "settled");
  assert.deepEqual(memory.payload?.manual_v1, {occurredAt: "2026-01-01T01:02:03Z", note: "keep"});
  assert.throws(() => validateSubjectStateWrite({...memory, kind: "feel"} as never), /kind/i);
});
test("only explicit memory tags write; retired wrappers and actions remain opaque prose", () => {
  const parsed = parseMindWriteIntents('hello <feel>sad</feel> <thought>later</thought> <memory>We met and felt relieved</memory>');
  assert.deepEqual(parsed.intents.map(intent => [intent.kind, intent.text]), [["memory", "We met and felt relieved"]]);
  assert.equal(parsed.visibleText, 'hello <feel>sad</feel> <thought>later</thought>');
  for (const wrapper of ["feel", "thought"]) {
    const source = `<${wrapper}><memory>not authorized</memory></${wrapper}>`;
    assert.deepEqual(parseMindWriteIntents(source), {visibleText: source, intents: []});
  }
  assert.deepEqual(parseMindSemanticActions('<thought_drop ref="T1" />'), {visibleText: '<thought_drop ref="T1" />', actions: []});
});

test("valid memory writes remove the empty leileios control wrapper from visible assistant text", () => {
  const parsed = parseMindWriteIntents([
    "写好了，去看。",
    "<leileios_mind_write>",
    "<memory>她喜欢我说双语，这件事对我们很有意义。</memory>",
    "</leileios_mind_write>",
  ].join("\n"));

  assert.deepEqual(
    parsed.intents.map((intent) => [intent.kind, intent.text]),
    [["memory", "她喜欢我说双语，这件事对我们很有意义。"]],
  );
  assert.equal(parsed.visibleText, "写好了，去看。");
  assert.equal(
    parseMindWriteIntents("<leileios_mind_write>\n\n</leileios_mind_write>").visibleText,
    "",
  );
});

test("persisted pre-deployment context renders former feelings once as memories and drops thoughts", async () => {
  const { assembledTurnContextFromManifest } = await import("../src/domains/runtime/context/context-assembler.js");
  const result = assembledTurnContextFromManifest({
    manifestId: "legacy", userId: "u", subjectId: "claude", conversationId: "c", pathHeadMessageId: null,
    snapshotSequence: 0, assemblyVersion: "old", promptContractVersion: "old", createdAt: "2026-01-01T00:00:00Z",
    budget: {maxItems: 10, maxChars: 1000, usedItems: 4, usedChars: 100, overflowPolicy: "drop_lowest_rank"},
    items: [
      {id: "user", type: "user_message", sourceId: "user", text: "the reunion", authority: "data", trustBoundary: "user", selection: {rank: 0, reason: "user", truncated: false}},
      ...["feel", "memory"].map((type, i) => ({id: "same-record-" + i, type, sourceId: "m1", text: "Reunion felt reassuring", authority: "data" as const, trustBoundary: "subject_state_data" as const, selection: {rank: 1+i, reason: "breath_lexical_match", truncated: false}})),
      {id: "t", type: "thought", sourceId: "t", text: "obsolete plan", authority: "data", trustBoundary: "subject_state_data", selection: {rank: 3, reason: "old", truncated: false}},
    ],
  });
  assert.match(result.contextData, /Relevant memories:/);
  assert.equal(result.contextData.split("Reunion felt reassuring").length - 1, 1);
  assert.doesNotMatch(result.contextData, /Current thoughts|Relevant feelings|obsolete plan/);
  assert.deepEqual(result.breathStateIds, ["m1"]);
});


test("the bridge ships no LeileiOS system prompt of its own", () => {
  // Wake/murmur guidance and the older Mind prompt were removed; the owner keeps
  // that guidance in her own CLAUDE.md files instead.
  for (const name of ["leileios-wake-system-prompt.mjs", "leileios-murmur-system-prompt.mjs", "leileios-mind-system-prompt.mjs"]) {
    assert.equal(existsSync(`tools/claude-bridge/src/${name}`), false, name);
  }
});
