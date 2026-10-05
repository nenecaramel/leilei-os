import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const surface = "ios/LeileiOS/LeileiOS/Chat/MessageSurface/";
test("real Swift Activity projection keeps one durable question across runtime retention and task hierarchy", { skip: process.platform !== "darwin" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "leilei-question-swift-"));
  try {
    const runtime = fs.readFileSync(surface + "NativeLiveToolActivity.swift", "utf8");
    const state = runtime.slice(runtime.indexOf("enum NativeLiveToolCallState:"), runtime.indexOf("struct NativeLiveToolCallCard:"));
    fs.writeFileSync(path.join(temporary, "State.swift"), state);
    fs.copyFileSync("tests/fixtures/native-live-question-activity.swift", path.join(temporary, "main.swift"));
    const projections = fs.readdirSync(surface).filter((name) => name.startsWith("NativeLiveTurnActivityProjection") && name.endsWith(".swift")).map((name) => surface + name);
    const compiled = spawnSync("xcrun", ["swiftc", "-module-cache-path", path.join(temporary, "cache"), "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", "ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", ...projections, path.join(temporary, "State.swift"), path.join(temporary, "main.swift"), "-o", path.join(temporary, "check")], { encoding: "utf8", timeout: 120_000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const ran = spawnSync(path.join(temporary, "check"), [], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /Question activity behavior passed/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
test("question presentation preserves the interactive card and uses Question / Response historical details", () => {
  const source = fs.readFileSync(surface + "NativeLiveRuntimeInteractions.swift", "utf8");
  assert.match(source, /struct NativeLiveQuestionActivityRow/);
  assert.match(source, /NativeLiveQuestionInteractionCard/);
  assert.match(source, /Text\("Asked user"\)/);
  assert.match(source, /sectionTitle: "Question"/);
  assert.match(source, /secondarySectionTitle: "Response"/);
});
