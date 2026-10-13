import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = 'ios/LeileiOS/LeileiOS/Chat/';
const baseline = readFileSync('tests/fixtures/composer-main-f7a254cc/ChatComposer.swift', 'utf8');
const current = () => readFileSync(root + 'ChatComposer.swift', 'utf8');
const compact = (s: string) => s.replace(/\s+/g, '');
function block(s: string, anchor: string) {
  const start = s.indexOf(anchor);
  assert.ok(start >= 0, `Missing contract boundary: ${anchor}`);
  const open = s.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth && end < s.length; end++) {
    if (s[end] === '{') depth++;
    else if (s[end] === '}') depth--;
  }
  assert.equal(depth, 0);
  return compact(s.slice(open + 1, end - 1));
}
function action(s: string) {
  const start = s.indexOf('let normalized = text.trimmingCharacters(');
  assert.ok(start >= 0);
  const end = s.indexOf('} label:', start);
  assert.ok(end > start);
  return compact(s.slice(start, end));
}
// Source conservation is intentional: this PR is forbidden to change these
// private callback bodies/guards. Render tests independently exercise the UI.
test('Composer extraction preserves action guards and model correction bodies', () => {
  const head = current();
  assert.equal(action(head), action(baseline));
  for (const name of ['actionPresentation', 'isVoiceActionMode', 'hasSendableContent', 'attachmentsReady', 'availableEffortLevels', 'modelSelection', 'thinkingSelection']) {
    assert.equal(block(head, `private var ${name}:`), block(baseline, `private var ${name}:`), name);
  }
  assert.equal(block(head, 'private func selectModel('), block(baseline, 'private func selectModel('));
  const disabled = /\.disabled\(\s*(isRuntimeControlInFlight[\s\S]*?)\n\s*\)\n/;
  assert.equal(compact(head.match(disabled)![1]), compact(baseline.match(disabled)![1]));
  const plusDisabled = /\.disabled\(\s*(isRuntimeTurnActive[\s\S]*?attachments\.count >= 8)\s*\)/;
  // 6d39a039 moved the conserved attachment gate onto individual actions so
  // the separately guarded call entry remains usable when attachments are full.
  assert.equal(compact(baseline.match(plusDisabled)![1]), 'isRuntimeTurnActive||isSending||attachments.count>=8');
  assert.ok(compact(head).includes('canAttach:!isRuntimeTurnActive&&!isSending&&attachments.count<8,onStartVoiceCall:onStartVoiceCall,canStartVoiceCall:canStartVoiceCall'));
});

test('Moved voice bridge retains every gesture, language binding and accessibility operation', () => {
  const moved = readFileSync(root + 'ComposerVoiceActionControl.swift', 'utf8');
  assert.equal(block(moved, 'struct NativeLiveVoiceActionControl:'), block(baseline, 'struct NativeLiveVoiceActionControl:'));
  assert.equal(block(current(), 'private var voiceActionButton:'), block(baseline, 'private var voiceActionButton:'));
});

test('Composer keeps attachment IDs and callback routes through presentation boundaries', () => {
  const attachments = readFileSync(root + 'ComposerAttachmentStrip.swift', 'utf8');
  const presentation = readFileSync(root + 'ComposerPresentationComponents.swift', 'utf8');
  assert.equal(block(attachments, 'struct NativeLiveComposerAttachmentChip:'), block(baseline, 'struct NativeLiveComposerAttachmentChip:'));
  assert.equal(block(attachments, 'struct NativeLiveComposerMediaThumbnail:'), block(baseline, 'struct NativeLiveComposerMediaThumbnail:'));
  assert.equal(block(attachments, 'ScrollView(.horizontal'), block(baseline, 'ScrollView(.horizontal'));
  const oldMenu = baseline.slice(baseline.lastIndexOf('Menu {', baseline.indexOf('Section("Model")')));
  const menu = presentation.slice(presentation.indexOf('struct ComposerModelMenu:'));
  const menuBody = block(menu, 'Menu {').replaceAll('modelOptions', compact('Array(NativeLiveClaudeModel.allCases.reversed())')).replaceAll('thinkingOptions', compact('Array(model.supportedThinkingModes.reversed())'));
  assert.equal(menuBody, block(oldMenu, 'Menu {'), 'Menu order, Picker style and selection routes');
  const acceptedAttachmentMenu = block(baseline, 'Menu {')
    .replace(/(Label\([^}]+\)})/g, '$1.disabled(!canAttach)')
    + compact(`Divider() Button { onStartVoiceCall?() } label: {
        Label("Call Claude", systemImage: "phone.fill")
      }.disabled(!canStartVoiceCall)`);
  assert.equal(block(presentation.slice(presentation.indexOf('struct ComposerAttachmentMenu:')), 'Menu {'), acceptedAttachmentMenu,
    'Original attachment callbacks each retain their gate; accepted call has its own gate');
  assert.equal(block(presentation, 'struct NativeLiveComposerTextInput:'), block(baseline, 'struct NativeLiveComposerTextInput:'));
  assert.equal(block(presentation, 'struct ComposerPrimaryActionButtonStyle:'), block(baseline, 'struct ComposerPrimaryActionButtonStyle:'));
  const oldLabel = block(baseline, 'private var composerActionLabel:').replaceAll('actionPresentation.', 'presentation.').replaceAll('composerActionSymbol', 'presentation.symbol').replaceAll('composerActionWeight', 'presentation.weight');
  assert.equal(block(presentation, 'struct ComposerPrimaryActionLabel:').split('varbody:someView{')[1].slice(0, -1), oldLabel);
  for (const route of ['onCancelEdit: onCancelEdit', 'onRemoveAttachment: onRemoveAttachment', 'onRetryAttachment: onRetryAttachment', 'onPickPhoto: onPickPhoto', 'onTakePhoto: onTakePhoto', 'onPickFile: onPickFile', 'modelSelection: modelSelection', 'thinkingSelection: thinkingSelection', 'effort: $effort']) {
    assert.ok(compact(current()).includes(compact(route)), route);
  }
  for (const callback of ['onCancelEdit?()', 'onPickPhoto?()', 'onTakePhoto?()', 'onPickFile?()']) assert.ok(compact(presentation).includes(callback), callback);
  for (const callback of ['onRemoveAttachment?(attachment.id)', 'onRetryAttachment?(attachment.id)']) assert.ok(compact(attachments).includes(callback), callback);
  assert.ok(compact(current()).includes('isFocused.wrappedValue=false'));
  assert.ok(compact(current()).includes('NativeLiveComposerTextInput(text:$text,textSnapshot:text,isFocused:isFocused,focusSnapshot:isFocused.wrappedValue).equatable()'));
  assert.ok(compact(presentation).includes('Picker("",selection:modelSelection)'));
  assert.ok(compact(presentation).includes('Picker("",selection:thinkingSelection)'));
  assert.ok(compact(presentation).includes('Picker("",selection:$effort)'));
  for (const options of ['Array(NativeLiveClaudeModel.allCases.reversed())', 'Array(model.supportedThinkingModes.reversed())']) assert.ok(compact(current()).includes(compact(options)));
});
