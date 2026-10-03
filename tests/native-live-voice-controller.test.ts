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


test("composer keeps voice-message hold behavior and adds pure tap-to-dictate on the mic", () => {
  const composer=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatComposer.swift","utf8");
  const chatView=readFileSync("ios/LeileiOS/LeileiOS/Chat/ChatView.swift","utf8");
  const controller=readFileSync("ios/LeileiOS/LeileiOS/Chat/VoiceInputController.swift","utf8");

  // Separate mic dictation path.
  assert.match(composer,/Button \{\s*guard dictationEnabled else \{ return \}\s*onDictationStart\?\(\)/);
  assert.match(composer,/ComposerCircleButton\(\s*systemName: "mic\.fill"/);
  assert.match(composer,/if isDictating \{\s*dictationComposerBody/);
  assert.match(composer,/private var dictationComposerBody: some View \{[\s\S]*systemName: "xmark"[\s\S]*NativeLiveDictationWaveform\(\)[\s\S]*systemName: "square\.fill"/);
  assert.match(composer,/onDictationCancel\?\(\)/);
  assert.match(composer,/onDictationStop\?\(\)/);

  // Existing trailing voice-message path stays intact.
  assert.match(composer,/if isVoiceActionMode \{\s*voiceActionButton/);
  assert.match(composer,/private var voiceActionButton: some View \{\s*Menu \{/);
  assert.match(composer,/Picker\("Voice language", selection: \$voiceLanguage\)/);
  assert.doesNotMatch(composer,/confirmationDialog/);
  assert.match(composer,/onLongPressGesture\(\s*minimumDuration: 0\.35/);
  assert.match(composer,/if isPressing \{\s*onVoiceInteractionBegin\?\(\)/);
  assert.match(composer,/voiceHoldActivated = true\s*onVoicePress\?\(\)/);
  assert.match(composer,/!isPressing,[\s\S]*voiceHoldActivated[\s\S]*onVoiceRelease\?\(\)/);

  // Dictation uses the selected locale, writes only into messageText, and never sends.
  assert.match(chatView,/@State private var isDictationModeActive = false/);
  assert.match(chatView,/dictationEnabled: dictationEnabled/);
  assert.match(chatView,/onDictationStart: \{\s*beginDictation\(\)/);
  assert.match(chatView,/onDictationStop: \{\s*voiceInput\.release\(\)/);
  assert.match(chatView,/onDictationCancel: \{[\s\S]*voiceInput\.cancel\(\)/);
  assert.match(chatView,/private func beginDictation\(\) \{[\s\S]*voiceInput\.begin\(\s*language: voiceLanguage[\s\S]*applyDictationTranscript\(transcript\)/);
  assert.match(chatView,/private func applyDictationTranscript\([\s\S]*messageText = dictated[\s\S]*messageText \+=/);
  const dictationSlice=chatView.slice(
    chatView.indexOf("private func beginDictation()"),
    chatView.indexOf("private var voiceEnabled:")
  );
  assert.doesNotMatch(dictationSlice,/sendNewMessage|sendVoiceMessage|inputMode/);

  assert.match(chatView,/@State private var voiceLanguage: VoiceInputLanguage = \.english/);
  assert.match(chatView,/voiceLanguage: \$voiceLanguage/);
  assert.match(chatView,/onVoiceInteractionBegin: \{\s*voiceInput\.dismissStatusMessage\(\)/);
  assert.match(controller,/case english = "en-US"/);
  assert.match(controller,/case chinese = "zh-CN"/);
  assert.match(controller,/SFSpeechRecognizer\(locale: language\.locale\)/);
  assert.doesNotMatch(controller,/SFSpeechRecognizer\(locale: \.current\)/);
  assert.match(controller,/func dismissStatusMessage\(\) \{\s*guard phase == \.idle else \{ return \}\s*errorMessage = nil/);
});
