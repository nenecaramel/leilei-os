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


test("composer uses the right action button for tap-to-language and hold-to-dictate", () => {
  const composer=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift","utf8");
  const chatView=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView.swift","utf8");
  const controller=readFileSync("ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift","utf8");
  assert.doesNotMatch(composer,/ComposerCircleButton\(systemName: "mic\.fill"\)/);
  assert.match(composer,/if isVoiceActionMode \{\s*voiceActionButton/);
  assert.match(composer,/confirmationDialog\(\s*"Voice language"/);
  assert.match(composer,/Task\.sleep\(for: \.milliseconds\(350\)\)/);
  assert.match(composer,/voiceLanguage = language/);
  assert.match(composer,/if voiceHoldActivated \{[\s\S]*onVoiceRelease\?\(\)/);
  assert.match(composer,/isVoiceLanguagePickerPresented = true/);
  assert.match(chatView,/@State private var voiceLanguage: VoiceInputLanguage = \.english/);
  assert.match(chatView,/voiceLanguage: \$voiceLanguage/);
  assert.match(chatView,/voiceInput\.begin\(\s*language: voiceLanguage/);
  assert.match(controller,/case english = "en-US"/);
  assert.match(controller,/case chinese = "zh-CN"/);
  assert.match(controller,/SFSpeechRecognizer\(locale: language\.locale\)/);
  assert.doesNotMatch(controller,/SFSpeechRecognizer\(locale: \.current\)/);
});
