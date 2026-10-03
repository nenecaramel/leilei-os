import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { canonicalizeNativeLiveEvents, type NativeLiveNormalizedEvent } from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
function backing(hidden: "hidden" | "ambient" | null) {
  const use = (id: string, parent?: string): NativeLiveNormalizedEvent => ({
    type: "tool_use", payload: {
      tool_use_id: id, tool_name: "Read", input: { path: "src/example.ts" },
      ...(parent ? { parent_tool_use_id: parent, parent_agent_id: "agent1" } : {}),
      display_name: "Display only", server_display_name: "Server", icon_url: "icon",
    },
  });
  const events: NativeLiveNormalizedEvent[] = hidden ? [
    { type: "task", payload: { tool_use_id: "root", ...(hidden === "hidden" ? { hidden_from_transcript: true } : { ambient: true }) } },
    // Reverse descendant order requires transitive propagation, not one pass.
    use("grandchild", "child"), use("child", "root"), use("root"), use("visible"),
  ] : [use("ordinary", "parent")];
  for (const event of [...events].filter(event => event.type === "tool_use")) {
    events.push({ type: "tool_result", payload: { tool_use_id: event.payload!.tool_use_id, output: "file contents", is_error: false } });
  }
  events.push({ type: "text", payload: { text: "Assistant answer" } });
  return canonicalizeNativeLiveEvents(events).blocks;
}

test("backend durable rows feed unchanged Swift historical Activity and assistant body filters", { skip: process.platform !== "darwin" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-tool-ledger-swift-"));
  try {
    const fixtures = Object.fromEntries((["ordinary", "hidden", "ambient"] as const).map(name => {
      const blocks = backing(name === "ordinary" ? null : name);
      assert.equal(blocks.filter(block => block.kind === "tool_use").length, name === "ordinary" ? 1 : 4);
      assert.equal(blocks.filter(block => block.kind === "tool_result").length, name === "ordinary" ? 1 : 4);
      assert.ok(!blocks.some(block => block.kind === "canonical_tool_result"));
      return [name, blocks.map((block, ordinal) => ({ id: `b${ordinal}`, ordinal, kind: block.kind, rawType: block.rawType ?? block.kind, text: block.text ?? null, payload: block.payload ?? null, createdAt: "" }))];
    }));
    fs.writeFileSync(path.join(temporary, "blocks.json"), JSON.stringify(fixtures));
    const runtime = fs.readFileSync(surface + "NativeLiveRuntimeActivity.swift", "utf8");
    fs.writeFileSync(path.join(temporary, "State.swift"), runtime.slice(runtime.indexOf("enum NativeLiveToolCallState:"), runtime.indexOf("struct NativeLiveToolCallCard:")));
    // Exercise the shared Chat projector while Activity still reads ledger rows.
    fs.writeFileSync(path.join(temporary, "Body.swift"), `import Foundation
func chatBody(_ message: NativeLiveCurrentPathMessage) -> [NativeLiveVisualNode] {
  NativeLiveMessagePresentationProjector.project(.canonical(message)).nodes
}
`);
    fs.copyFileSync("tests/fixtures/native-live-tool-durable-activity.swift", path.join(temporary, "main.swift"));
    const projections = fs.readdirSync(surface).filter(name => name.startsWith("NativeLiveTurnActivityProjection") && name.endsWith(".swift")).map(name => surface + name);
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", ...projections, ...["NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name), "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", path.join(temporary, "State.swift"), path.join(temporary, "Body.swift"), path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary, "check"), [path.join(temporary, "blocks.json")], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /Durable tool Activity passed/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
