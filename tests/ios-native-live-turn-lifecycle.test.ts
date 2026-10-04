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
