import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("real Swift turn lifecycle reconciles every Send Edit Retry and recovery frame", { skip: process.platform !== "darwin" }, t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-presentation-swift-"));
  const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  try {
    fs.copyFileSync("tests/fixtures/native-live-turn-lifecycle.swift", path.join(temporary, "main.swift"));
    const modelFiles = ["NativeLivePendingOperation.swift", "NativeLiveAssistantTurnPresentation.swift", "NativeLiveTurnIdentityCoordinator.swift", "NativeLiveConversationPresentationAssembler.swift", "NativeLiveMessageUIStateStore.swift", "NativeLiveConversationScrollState.swift", "NativeLiveTurnActivityProjection.swift", "NativeLiveTurnActivityProjection+Tools.swift", "NativeLiveTurnActivityProjection+Tasks.swift", "NativeLiveTurnActivityProjection+Questions.swift", "NativeLiveTurnActivityProjection+Lifecycle.swift", "NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveVisualRendererRegistry.swift", "NativeLiveVisualSandboxModel.swift", "NativeLiveSVGModel.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name).filter(file => fs.existsSync(file));
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", ...modelFiles,  path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary,"check"),[],{encoding:"utf8",timeout:60_000});
    assert.equal(ran.status,0,ran.stderr);
    assert.match(ran.stdout,/Turn lifecycle PASS/); t.diagnostic(ran.stdout.trim());
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});


test("user interrupt unlocks send/edit without restoring the stopped draft", () => {
  const controller = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/App/NativeLiveTurnController.swift",
    "utf8",
  );
  assert.match(
    controller,
    /turn\.failureCode == "INTERRUPTED"[\s\S]*NativeLiveSendError\.interrupted/,
  );
  assert.match(
    controller,
    /catch NativeLiveSendError\.interrupted \{[\s\S]*chatSendState = \.idle/,
  );

  const appModel = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/App/AppModel.swift",
    "utf8",
  );
  assert.match(appModel, /case interrupted/);

  const chat = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
    "utf8",
  );
  const interruptedCatches =
    chat.match(/catch NativeLiveSendError\.interrupted \{[\s\S]*?\n\s*\}/g)
      ?? [];
  assert.ok(interruptedCatches.length >= 2);
  for (const block of interruptedCatches) {
    assert.match(block, /pendingOperation = nil/);
    assert.doesNotMatch(block, /messageText = pendingText|editDraft = draft/);
  }
});


test("composer keeps UIKit caret ownership across runtime refreshes", () => {
  const composer = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift",
    "utf8",
  );
  assert.doesNotMatch(
    composer,
    /TextField\([\s\S]{0,220}Write a message/,
  );
  assert.match(
    composer,
    /NativeLiveStableComposerTextView/,
  );
  assert.match(
    composer,
    /UIViewRepresentable/,
  );
  assert.match(
    composer,
    /if view\.text != text,[\s\S]*view\.markedTextRange == nil/,
  );
  assert.match(
    composer,
    /previousSelection = view\.selectedRange[\s\S]*view\.selectedRange = NSRange/,
  );
  assert.match(
    composer,
    /textViewDidChange[\s\S]*parent\.text = next/,
  );

  const chat = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
    "utf8",
  );
  assert.doesNotMatch(
    chat,
    /\.contentShape\(Rectangle\(\)\)[\s\S]{0,100}isComposerFocused = false/,
  );

  const surface = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
    "utf8",
  );
  assert.match(
    surface,
    /\.scrollDismissesKeyboard\(\.interactively\)/,
  );
});
