import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("real Swift E rich Markdown projects typed children without changing canonical text", { skip: process.platform !== "darwin" }, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-presentation-swift-"));
  const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  try {
    fs.copyFileSync("tests/fixtures/native-live-rich-markdown.swift", path.join(temporary, "main.swift"));
    const modelFiles = ["NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name).filter(file => fs.existsSync(file));
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", ...modelFiles,  path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const runs = [[], ["--review-budget"], ["--review-format"], ["--review-spans"], ["--review-crlf"], ["--review-quotes"]].map(args => spawnSync(path.join(temporary,"check"),args,{encoding:"utf8",timeout:60_000}));
    assert.ok(runs.every(run=>run.status===0),runs.map(run=>run.stderr).join("\n"));
    for(const ran of runs) { assert.match(ran.stdout,/Rich Markdown PASS/); t.diagnostic(ran.stdout.trim()); }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("E renderers use the shared registry and fail visible without provider identity switches", () => {
  const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  for (const file of [surface + "ChatMarkdown.swift", surface + "NativeLiveMessageBlocks.swift", surface + "NativeLiveMessageRows.swift"]) {
    assert.ok(fs.existsSync(file), file);
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /default\s*:\s*EmptyView\(\)/);
    assert.doesNotMatch(source, /(?:switch|if)\s+[^\n]*(?:canonicalIdentity|provider|rawType|\.kind\s*==\s*"tool_result")/);
  }
  const inline = fs.readFileSync(surface + "ChatMarkdown.swift", "utf8");
  assert.doesNotMatch(inline, /ChatMarkdownParser|blocks\(from:/);
  const render = fs.readFileSync(surface + "NativeLiveMessageBlocks.swift", "utf8");
  for (const kind of ["code", "table", "diff", "math", "mermaid"]) assert.match(render, new RegExp(`case \\.${kind}:`));
  assert.match(render, /NativeLiveMessageRendererRegistry\.renderer/);
});

test("rich projection caches exact input in a bounded cache outside SwiftUI body", () => {
  const source = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRichTextProjection.swift", "utf8");
  assert.match(source, /cache\.lookup/);
  assert.match(source, /cache\.store/);
});

test("live streaming text enters the same rich presentation projection", () => {
  const source = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRuntimeActivity.swift", "utf8");
  assert.match(source, /NativeLiveMessagePresentationProjector\.project/);
  assert.doesNotMatch(source, /ChatMarkdownView\(/);
});
