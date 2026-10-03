import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("voice controller waits for final text, fails on timeout, and ignores cancelled session callbacks", {skip:process.platform !== "darwin"}, () => {
  const dir=mkdtempSync(join(tmpdir(),"leileios-voice-controller-"));
  try {
    const controller=readFileSync("ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift","utf8").replace(/^import (AVFoundation|Speech)\n/gm,"");
    const source=readFileSync("tests/fixtures/voice-input/apple-boundaries.swift","utf8")+"\n"+controller+"\n"+readFileSync("tests/fixtures/voice-input/controller-checks.swift","utf8");
    writeFileSync(join(dir,"controller.swift"),source);
    execFileSync("swiftc",["-parse-as-library",join(dir,"controller.swift"),"-o",join(dir,"check")]);
    assert.equal(execFileSync(join(dir,"check"),{encoding:"utf8"}).trim(),"controller lifecycle PASS");
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test("voice action has language selection and no separate mic control", () => {
  const composer = readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift", "utf8");
  const chatView = readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView.swift", "utf8");
  const controller = readFileSync("ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift", "utf8");

  assert.equal(composer.includes('ComposerCircleButton(systemName: "mic.fill")'), false);
  assert.equal(composer.includes('"Voice language"'), true);
  assert.equal(composer.includes("VoiceInputLanguage.allCases"), true);
  assert.equal(composer.includes(".milliseconds(350)"), true);
  assert.equal(chatView.includes("voiceLanguage: $voiceLanguage"), true);
  assert.equal(chatView.includes("language: voiceLanguage"), true);
  assert.equal(controller.includes('case english = "en-US"'), true);
  assert.equal(controller.includes('case chinese = "zh-CN"'), true);
  assert.equal(controller.includes("SFSpeechRecognizer(locale: language.locale)"), true);
  assert.equal(controller.includes("SFSpeechRecognizer(locale: .current)"), false);
});
