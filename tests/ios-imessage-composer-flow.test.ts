import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chat = "ios/LeileiOS/LeileiOS/Chat/";
const read = (name: string) => readFileSync(chat + name, "utf8");

test("Original composer keeps its original status, attachment and edit styles", () => {
  const composer = read("ChatComposer.swift");
  const chips = read("ComposerAttachmentStrip.swift");
  const status = read("ComposerPresentationComponents.swift");
  const original = composer.split("private var sharedComposerContent: some View")[1]!.split("// iMessage shell:")[0]!;
  assert.match(original, /ComposerStatusArea\([\s\S]*?onCancelEdit: onCancelEdit\s*\)/);
  assert.match(original, /ComposerAttachmentStrip\(/);
  assert.match(chips, /if chatTheme == \.iMessage \{\s*iMessageBody\s*\} else \{\s*originalBody/);
  assert.match(chips, /private var originalBody: some View/);
  assert.match(chips, /Color\.chatSoftFill/);
  assert.match(status, /private var originalBanner: some View/);
  assert.match(status, /Text\("Edit message"\)/);
});

test("iMessage attachment chips use the composer glass and preserve the upload action owner", () => {
  const chips = read("ComposerAttachmentStrip.swift");
  const imessage = chips.split("private var iMessageBody: some View")[1]!.split("private struct NativeLiveComposerMediaThumbnail")[0]!;
  assert.match(imessage, /case \.uploading:[\s\S]*?ProgressView\(\)/);
  assert.match(imessage, /case \.ready:\s*EmptyView\(\)/);
  assert.match(imessage, /case \.failed:[\s\S]*?Image\(systemName: "exclamationmark"\)/);
  assert.match(imessage, /Button\(action: onRetry\)/);
  assert.match(imessage, /accessibilityLabel\("Retry upload"\)/);
  assert.match(imessage, /Button\(action: onRemove\)/);
  assert.match(imessage, /\.glassEffect\(\.regular, in: Circle\(\)\)/);
  assert.match(imessage, /\.frame\(width: 30, height: 30\)/);
  assert.doesNotMatch(imessage, /checkmark\.circle\.fill/);
});

test("iMessage editing and voice status are glass but retain shared callbacks and source state", () => {
  const composer = read("ChatComposer.swift");
  const status = read("ComposerPresentationComponents.swift");
  const view = read("ChatView.swift");
  const voice = read("VoiceInputController.swift");
  assert.match(composer, /isIMessage: true,\s*voicePhase: voicePhase/);
  assert.match(view, /voicePhase: voiceInput\.phase/);
  assert.match(status, /Text\("Editing message"\)/);
  assert.match(status, /onCancelEdit\?\(\)/);
  assert.match(status, /private struct IMessageVoiceStatusView/);
  assert.match(status, /case \.recording:\s*IMessageVoiceWaveform\(\)/);
  assert.match(status, /case \.authorizing, \.finishing:\s*ProgressView\(\)/);
  assert.match(status, /case \.idle:\s*Image\(systemName: "exclamationmark\.circle\.fill"\)/);
  assert.match(status, /TimelineView\(\.animation\(minimumInterval: 0\.12\)\)/);
  assert.match(voice, /enum Phase \{ case idle, authorizing, recording, finishing \}/);
  assert.match(composer, /onVoicePress\?\(\)/);
  assert.match(composer, /onVoiceRelease\?\(\)/);
  assert.match(composer, /onSend\?\(\)/);
});
