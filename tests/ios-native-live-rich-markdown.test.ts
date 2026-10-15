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
  assert.match(surface, /showCopyFeedback\(\s*"Message copied"/);
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


test("all special-card top-right copy glyphs rotate in place across both chat themes", () => {
  const root = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  const source = fs.readFileSync(root + "NativeLiveCodeRenderer.swift", "utf8");
  const visual = fs.readFileSync(root + "NativeLiveVisualSurface.swift", "utf8");
  const table = fs.readFileSync(root + "NativeLiveTableRenderer.swift", "utf8");
  const diff = fs.readFileSync(root + "NativeLiveDiffRenderer.swift", "utf8");
  const math = fs.readFileSync(root + "NativeLiveMathRenderer.swift", "utf8");
  const svg = fs.readFileSync(root + "NativeLiveSVGRenderer.swift", "utf8");
  const actions = fs.readFileSync(root + "NativeLiveAssistantActions.swift", "utf8");

  // Rotate only the SF Symbol inside its existing fixed 24x24 hit target,
  // and leave the temporary "Copied" checkmark in its normal orientation.
  const icon = /Image\(\s*systemName:\s*isCopied\s*\?\s*"checkmark"\s*:\s*"square\.on\.square"\s*\)\s*\.font\(\.system\(size: 15\)\)\s*\.rotationEffect\(\.degrees\(isCopied \? 0 : 180\)\)\s*\.frame\(width: 24, height: 24\)/;
  for (const [name, text] of [
    ["code/table/diff shared source", source],
    ["math/Mermaid visual preview", visual],
  ] as const) {
    assert.match(text, icon, name);
    assert.equal((text.match(/\.rotationEffect\(\.degrees\(isCopied \? 0 : 180\)\)/g) ?? []).length, 1);
    assert.match(text, /\.buttonStyle\(\.plain\)/);
    assert.match(text, /accessibilityLabel\(/);
  }

  // No new per-theme branch; all content types use the same two shared
  // copy controls and their original copy/status implementations.
  assert.match(source, /struct NativeLiveSourcePanel<Content: View>: View/);
  assert.match(source, /NativeLiveSourcePanel\(label: model\.language/);
  assert.match(table, /NativeLiveSourcePanel\(label: "Table"/);
  assert.match(diff, /NativeLiveSourcePanel\(label: "Diff"/);
  assert.match(math, /NativeLiveSourcePanel\(/);
  assert.match(visual, /private var regularSurface: some View/);
  assert.match(svg, /NativeLiveVisualSurface\(input:visual/);
  assert.match(source, /UIPasteboard\.general\.string = copyText/);
  assert.match(visual, /UIPasteboard\.general\.string = input\.source/);
  assert.match(actions, /\.rotationEffect\(\.degrees\(isCopied \? 0 : 180\)\)/);
  assert.doesNotMatch(source, /chatTheme == \.iMessage[\s\S]*?rotationEffect/);
  assert.doesNotMatch(visual, /chatTheme == \.iMessage[\s\S]*?rotationEffect/);
});

test("iMessage Markdown bubble links match ordinary white message text and quotes use softer white", () => {
  const root = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  const markdown = fs.readFileSync(root + "ChatMarkdown.swift", "utf8");
  const math = fs.readFileSync(root + "NativeLiveMathRenderer.swift", "utf8");
  const model = fs.readFileSync(root + "NativeLiveMarkdownModel.swift", "utf8");
  const bubble = fs.readFileSync(root + "NativeLiveIMessageTextBubbles.swift", "utf8");

  // The palette follows the same 98%-white as the bubble's ordinary body text.
  assert.match(bubble, /\.foregroundStyle\(Color\.white\.opacity\(0\.98\)\)/);
  assert.match(markdown, /static let body = Color\.white\.opacity\(0\.98\)/);
  assert.match(markdown, /static let quote = Color\.white\.opacity\(0\.86\)/);
  assert.match(markdown, /static func inline\(_ source: AttributedString, isQuote: Bool\) -> AttributedString/);
  assert.match(markdown, /let linkRanges = source\.runs\.compactMap/);
  assert.match(markdown, /run\.link == nil \? nil : run\.range/);
  assert.match(markdown, /styled\[range\]\.foregroundColor = isQuote \? quote : body/);
  assert.doesNotMatch(markdown, /styled\[range\]\.link = nil/);

  // Only actual iMessage user/assistant bubbles recolor link runs.
  for (const renderer of [markdown, math]) {
    assert.match(renderer, /chatTheme == \.iMessage && \(role == "user" \|\| role == "assistant"\)/);
    assert.match(renderer, /isIMessageBubbleText\s*\? NativeLiveIMessageMarkdownPalette\.inline\(/);
    assert.match(renderer, /: model\.inline|: markdown\.inline/);
    assert.match(renderer, /if isIMessageBubbleText \{\s*(?:inline|flow)\.foregroundStyle\(NativeLiveIMessageMarkdownPalette\.quote\)/);
    assert.match(renderer, /else \{\s*(?:inline\.foregroundStyle\(\.secondary\)|flow\s*\.foregroundStyle\(\.secondary\))/);
    assert.match(renderer, /if case \.quote\(_\) = model\.style/);
  }

  // Original link parsing, security checks and underline/tap behaviors remain.
  assert.match(model, /value\[run\.range\]\.foregroundColor = \.accentColor/);
  assert.match(model, /value\[run\.range\]\.underlineStyle = \.single/);
  assert.match(model, /NativeLiveLinkCapability\.openableURL/);
  assert.match(markdown, /NativeLiveLinkCapability\.openableURL\(url\.absoluteString\)/);
  assert.match(math, /NativeLiveLinkCapability\.openableURL\(/);
  assert.match(markdown, /Text\(\s*isIMessageBubbleText/);
  assert.match(math, /Text\(\s*isIMessageBubbleText/);
});
