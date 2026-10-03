import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("real Swift presentation unifies canonical/draft/Edit and preserves ledger, voice and fallback semantics", { skip: process.platform !== "darwin" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-presentation-swift-"));
  const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
  try {
    fs.copyFileSync("tests/fixtures/native-live-message-presentation.swift", path.join(temporary, "main.swift"));
    const pending = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift", "utf8");
    fs.writeFileSync(path.join(temporary, "Pending.swift"), "import Foundation\n" + pending.slice(pending.indexOf("struct NativeLivePendingOperation:"), pending.indexOf("struct NativeLiveMessageSurface:")));
    const modelFiles = ["NativeLiveMediaPresentation.swift", "NativeLiveAttachmentCache.swift", "NativeLiveMarkdownModel.swift", "NativeLiveRichTextProjection.swift", "NativeLiveVisualNode.swift", "NativeLiveStructuredToolResult.swift", "NativeLiveCitationPresentation.swift", "NativeLiveStructuredJSON.swift", "NativeLiveMessagePresentation.swift", "NativeLiveMessagePresentationProjection.swift"].map(name => surface + name).filter(file => fs.existsSync(file));
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveInputMode.swift", ...modelFiles, path.join(temporary, "Pending.swift"), path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary, "check"), [], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /Message presentation behavior passed/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
