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
    const modelFiles = ["NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveVisualRendererRegistry.swift", "NativeLiveVisualSandboxModel.swift", "NativeLiveSVGModel.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name).filter(file => fs.existsSync(file));
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", ...modelFiles,  path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const runs = [["--review-digit-math"], [], ["--review-budget"], ["--review-format"], ["--review-spans"], ["--review-crlf"], ["--review-quotes"]].map(args => spawnSync(path.join(temporary,"check"),args,{encoding:"utf8",timeout:60_000}));
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
  const source = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveConversationPresentationAssembler.swift", "utf8");
  assert.match(source, /NativeLiveMessagePresentationProjector\.project/);
  assert.doesNotMatch(source, /ChatMarkdownView\(/);
});


test("source panels match assistant copy interaction without growing the button", () => {
  const source = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveCodeRenderer.swift",
    "utf8",
  );
  assert.match(source, /"square\.on\.square"/);
  assert.match(source, /"checkmark"/);
  assert.match(source, /font\(\.system\(size: 15\)\)/);
  assert.match(source, /frame\(width: 24, height: 24\)/);
  assert.match(source, /copyFeedback\("Copied"\)/);
  assert.match(source, /UIPasteboard\.general\.string = copyText/);
  assert.match(source, /Task\.sleep\(for: \.seconds\(2\)\)/);
  assert.doesNotMatch(source, /Text\("Copied"\)/);
  assert.doesNotMatch(source, /"doc\.on\.doc"/);

  const surface = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
    "utf8",
  );
  const chrome = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageSurfaceChrome.swift",
    "utf8",
  );
  assert.match(surface, /copyFeedbackText/);
  assert.match(surface, /NativeLiveCopyFeedbackBanner\(text: copyFeedbackText\)/);
  assert.match(chrome, /Text\(text\)/);
  assert.match(surface, /showCopyFeedback\("Message copied"/);
  assert.match(surface, /\.environment\(\\\.nativeLiveCopyFeedback\)/);
});


test("safe Markdown links are visibly distinct from ordinary text", () => {
  const source = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMarkdownModel.swift",
    "utf8",
  );
  assert.match(source, /foregroundColor = \.accentColor/);
  assert.match(source, /underlineStyle = \.single/);
  assert.match(source, /NativeLiveLinkCapability\.openableURL/);
});


test("compact provider tables, inline math visuals, wide math scrolling and visual copy stay supported", () => {
  const projection = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRichTextProjection.swift",
    "utf8",
  );
  assert.match(
    projection,
    /guard !dashes\.isEmpty, dashes\.allSatisfy/,
  );

  const blocks = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageBlocks.swift",
    "utf8",
  );
  assert.match(
    blocks,
    /NativeLiveInlineMathParagraphRenderer/,
  );

  const math = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMathRenderer.swift",
    "utf8",
  );
  assert.match(math, /NativeLiveInlineMathFlowLayout/);
  assert.match(
    math,
    /NativeLiveVisualSandboxInput\.inlineMath/,
  );

  const visual = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveVisualSurface.swift",
    "utf8",
  );
  assert.match(
    visual,
    /ScrollView\([\s\S]*\.horizontal[\s\S]*displayMathWidth/,
  );
  assert.match(visual, /"square\.on\.square"/);
  assert.match(visual, /"checkmark"/);
  assert.match(
    visual,
    /frame\(width: 24, height: 24\)/,
  );
  assert.match(
    visual,
    /copyFeedback\("Copied"\)/,
  );
  assert.doesNotMatch(visual, /"doc\.on\.doc"/);
});
