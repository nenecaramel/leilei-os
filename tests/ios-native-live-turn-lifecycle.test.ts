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
    const modelFiles = ["NativeLivePendingOperation.swift", "NativeLiveAssistantTurnPresentation.swift", "NativeLiveVisibleThinkingProjection.swift", "NativeLiveTurnIdentityCoordinator.swift", "NativeLiveConversationPresentationAssembler.swift", "NativeLiveMessageUIStateStore.swift", "NativeLiveConversationScrollState.swift", "NativeLiveTurnActivityProjection.swift", "NativeLiveTurnActivityProjection+Tools.swift", "NativeLiveTurnActivityProjection+Tasks.swift", "NativeLiveTurnActivityProjection+Questions.swift", "NativeLiveTurnActivityProjection+Lifecycle.swift", "NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveVisualRendererRegistry.swift", "NativeLiveVisualSandboxModel.swift", "NativeLiveSVGModel.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name).filter(file => fs.existsSync(file));
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
  ) + fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView+MessageMutation.swift", "utf8");
  const interruptedCatches =
    chat.match(/catch NativeLiveSendError\.interrupted \{[\s\S]*?\n\s*\}/g)
      ?? [];
  assert.ok(interruptedCatches.length >= 2);
  for (const block of interruptedCatches) {
    assert.match(block, /pendingOperation = nil/);
    assert.doesNotMatch(block, /messageText = pendingText|editDraft = draft/);
  }
});


test("composer typing is isolated from unrelated chat churn", () => {
  const composer = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift",
    "utf8",
  );
  assert.match(
    composer,
    /NativeLiveComposerTextInput\([\s\S]{0,220}textSnapshot: text[\s\S]{0,220}focusSnapshot: isFocused\.wrappedValue[\s\S]{0,120}\.equatable\(\)/,
  );
  const inputPresentation = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ComposerPresentationComponents.swift",
    "utf8",
  );
  assert.match(
    inputPresentation,
    /struct NativeLiveComposerTextInput: View, Equatable[\s\S]{0,900}TextField\([\s\S]{0,260}Write a message[\s\S]{0,260}\.focused\(isFocused\)/,
  );
  assert.match(inputPresentation, /lhs\.textSnapshot == rhs\.textSnapshot[\s\S]{0,100}lhs\.focusSnapshot == rhs\.focusSnapshot/);
  assert.doesNotMatch(
    composer,
    /NativeLiveStableComposerTextView/,
  );

  const chat = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
    "utf8",
  );
  assert.doesNotMatch(
    chat,
    /\.contentShape\(Rectangle\(\)\)[\s\S]{0,100}isComposerFocused = false/,
  );
  assert.match(
    chat,
    /\.onChange\(of: voiceEnabled\)[\s\S]{0,180}guard !enabled, voiceInput\.isActive else \{ return \}[\s\S]{0,100}voiceInput\.cancel\(\)/,
  );

  const voice = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift",
    "utf8",
  );
  assert.match(
    voice,
    /func cancel\(\) \{[\s\S]{0,420}guard phase != \.idle[\s\S]{0,420}else \{[\s\S]{0,80}return/,
  );

  const surface = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
    "utf8",
  );
  // Interactive keyboard dismissal was approved for both the populated and
  // empty scroll surfaces. This must not be treated as composer churn.
  assert.equal(
    (surface.match(/\.scrollDismissesKeyboard\(\.interactively\)/g) ?? []).length,
    2,
  );

  // Runtime refresh identity and unchanged-poll churn are exercised against
  // the actual Swift methods in ios-runtime-delivery-latency.test.ts. Do not
  // require the old whole-snapshot writeback syntax: it delayed streamed text
  // behind secondary reads and could overwrite concurrent control state.

  const presentationStore = fs.readFileSync(
    "ios/LeileiOS/LeileiOS/App/NativeLiveConversationPresentationStore.swift",
    "utf8",
  );
  assert.match(
    presentationStore,
    /if rows != nativeLiveConversationRows \{[\s\S]{0,120}nativeLiveConversationRows = rows/,
  );
});
