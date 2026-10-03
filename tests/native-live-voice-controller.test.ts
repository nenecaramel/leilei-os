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


test("composer keeps mic placeholder and arbitrates trailing tap versus hold in one native control", () => {
  const composer=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift","utf8");
  const chatView=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView.swift","utf8");
  const controller=readFileSync("ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift","utf8");

  // Mic is back to decorative placeholder only.
  assert.match(composer,/ComposerCircleButton\(\s*systemName: "mic\.fill"/);
  assert.doesNotMatch(composer,/onDictationStart|dictationEnabled|isDictating|NativeLiveDictationWaveform/);

  // Trailing voice control no longer stacks SwiftUI Menu + onLongPressGesture.
  assert.match(composer,/private var voiceActionButton: some View \{\s*NativeLiveVoiceActionControl\(/);
  assert.doesNotMatch(composer,/private var voiceActionButton: some View \{\s*Menu \{/);
  assert.doesNotMatch(composer,/\.onLongPressGesture\(/);

  // A single UIKit arbiter owns tap and hold.
  assert.match(composer,/struct NativeLiveVoiceActionControl: UIViewRepresentable/);
  assert.match(composer,/UILongPressGestureRecognizer\(/);
  assert.match(composer,/longPress\.minimumPressDuration = 0\.35/);
  assert.match(composer,/UITapGestureRecognizer\(/);
  assert.match(composer,/tap\.require\(toFail: longPress\)/);
  assert.match(composer,/UIEditMenuInteraction\(/);
  assert.match(composer,/editMenuInteraction\.presentEditMenu/);
  assert.match(composer,/case \.began:[\s\S]*parent\.onVoicePress\(\)/);
  assert.match(composer,/case \.ended, \.cancelled, \.failed:[\s\S]*parent\.onVoiceRelease\(\)/);
  assert.match(composer,/VoiceInputLanguage\.allCases\.map/);
  assert.match(composer,/language == parent\.voiceLanguage[\s\S]*\? \.on/);

  // Existing language and speech wiring remains.
  assert.match(chatView,/@State private var voiceLanguage: VoiceInputLanguage = \.english/);
  assert.match(chatView,/voiceLanguage: \$voiceLanguage/);
  assert.match(chatView,/onVoiceInteractionBegin: \{\s*voiceInput\.dismissStatusMessage\(\)/);
  assert.match(chatView,/voiceInput\.begin\(\s*language: voiceLanguage/);
  assert.match(controller,/case english = "en-US"/);
  assert.match(controller,/case chinese = "zh-CN"/);
  assert.match(controller,/SFSpeechRecognizer\(locale: language\.locale\)/);
  assert.doesNotMatch(controller,/SFSpeechRecognizer\(locale: \.current\)/);
  assert.match(controller,/func dismissStatusMessage\(\) \{\s*guard phase == \.idle else \{ return \}\s*errorMessage = nil/);
});
