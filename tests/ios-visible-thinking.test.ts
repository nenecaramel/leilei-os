import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
test("user-visible thinking is explicitly projected without exposing raw tool output", () => {
  const parser = readFileSync(root + "NativeLiveVisibleThinkingProjection.swift", "utf8");
  const surface = readFileSync(root + "NativeLiveVisibleThinkingSurface.swift", "utf8");
  const bridge = readFileSync("tools/claude-bridge/src/normalized-events.mjs", "utf8");
  const row = readFileSync(root + "NativeLiveAssistantTurnRow.swift", "utf8");
  const turn = readFileSync(root + "NativeLiveAssistantTurnPresentation.swift", "utf8");
  const assembler = readFileSync(root + "NativeLiveConversationPresentationAssembler.swift", "utf8");
  assert.match(bridge, /kind: "user_visible_thinking"/);
  assert.match(bridge, /block\?\.type === "thinking"/);
  assert.match(bridge, /!raw\.parent_tool_use_id && !raw\.parent_agent_id/);
  assert.match(parser, /fields\["kind"\]\?\.stringValue == "user_visible_thinking"/);
  assert.match(parser, /entry\.event\.type == "runtime"/);
  assert.match(parser, /seen\.insert\(id\)\.inserted/);
  assert.match(surface, /ForEach\(items\)/);
  assert.match(surface, /\.textSelection\(\.enabled\)/);
  assert.match(assembler, /turn\.visibleThinking = NativeLiveVisibleThinkingProjector\.project/);
  assert.match(turn, /var visibleThinking: \[NativeLiveVisibleThinkingItem\] = \[\]/);
  assert.match(row, /NativeLiveVisibleThinkingSurface\(items: turn\.visibleThinking\)/);
  assert.doesNotMatch(parser + surface, /tool\.output|isReasoning|raw_metadata/);
});

test("Swift projector filters unrelated events, deduplicates and preserves prior display", {
  skip: spawnSync(process.platform === "darwin" ? "xcrun" : "swiftc",
    process.platform === "darwin" ? ["swiftc", "--version"] : ["--version"],
    { encoding: "utf8", timeout: 10000 }).status !== 0,
}, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ios-thinking-"));
  try {
    const files = [
      root + "NativeLiveVisibleThinkingProjection.swift",
      "tests/fixtures/ios-visible-thinking.swift",
    ];
    const command = process.platform === "darwin" ? "xcrun" : "swiftc";
    const args = process.platform === "darwin"
      ? ["swiftc", "-parse-as-library", ...files, "-o", path.join(dir, "check")]
      : ["-parse-as-library", ...files, "-o", path.join(dir, "check")];
    const compiled = spawnSync(command, args, { encoding: "utf8", timeout: 120000 });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const executed = spawnSync(path.join(dir, "check"), [], { encoding: "utf8", timeout: 30000 });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.match(executed.stdout, /User-visible thinking projection PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("completed assistant messages read explicit thinking events without unrelated runtime telemetry", () => {
  const read = readFileSync("src/domains/conversation/native-live-message-activity-read-repository.ts", "utf8");
  assert.match(read, /eq\(nativeLiveRuntimeEvents\.eventType, "task"\)/);
  assert.match(read, /eq\(nativeLiveRuntimeEvents\.eventType, "runtime"\)/);
  assert.match(read, /->> 'kind' = 'user_visible_thinking'/);
  assert.doesNotMatch(read, /inArray\(nativeLiveRuntimeEvents\.eventType, \["task", "runtime"\]\)/);
});
