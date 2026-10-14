import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ios = 'ios/LeileiOS/LeileiOS/';
const read = (path: string) => readFileSync(ios + path, 'utf8');

test('Chat themes use a single persistent, default-original preference', () => {
  const theme = read('Chat/ChatTheme.swift');
  const chat = read('Chat/ChatView.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');

  assert.match(theme, /enum ChatTheme: String, CaseIterable, Identifiable, Sendable/);
  assert.match(theme, /case original = "original"/);
  assert.match(theme, /case iMessage = "imessage"/);
  assert.match(theme, /static let storageKey = "chat.theme"/);
  assert.match(theme, /static let defaultValue: ChatTheme = \.original/);
  assert.match(chat, /@AppStorage\(ChatTheme\.storageKey\) private var chatThemeRawValue/);
  assert.match(settings, /@AppStorage\(ChatTheme\.storageKey\) private var chatThemeRawValue/);
  assert.match(settings, /Picker\(selection: \$chatThemeRawValue\)/);
  assert.match(settings, /ForEach\(ChatTheme\.allCases\)/);
});

test('Theme selection only decorates the existing shared chat content', () => {
  const chat = read('Chat/ChatView.swift');
  const composer = read('Chat/ChatComposer.swift');
  const theme = read('Chat/ChatTheme.swift');

  assert.match(chat, /NativeLiveMessageSurface\(/);
  assert.match(chat, /ChatComposer\(/);
  assert.match(chat, /\.environment\(\\\.chatTheme, selectedChatTheme\)/);
  assert.match(theme, /extension EnvironmentValues/);
  assert.match(composer, /@Environment\(\\\.chatTheme\) private var chatTheme/);
  assert.match(composer, /switch chatTheme/);
  assert.match(composer, /case \.original:/);
  assert.match(composer, /case \.iMessage:/);
  assert.match(composer, /private var sharedComposerContent: some View/);
  assert.match(composer, /NativeLiveComposerTextInput\(/);
  assert.match(composer, /primaryActionButton/);
});

test('Theme foundation leaves navigation/menu and scroll ownership untouched', () => {
  const theme = read('Chat/ChatTheme.swift');
  const composer = read('Chat/ChatComposer.swift');
  assert.doesNotMatch(theme, /sendNativeLiveMessage|interruptNativeLiveTurn|ScrollViewReader|conversationMenuContent/);
  assert.match(composer, /onMidTurnInput\?\(normalized\)/);
  assert.match(composer, /onInterrupt\?\(\)/);
  assert.match(composer, /onSend\?\(\)/);
});

test('iMessage Composer uses Apple-native controls while retaining existing action owner', () => {
  const composer = read('Chat/ChatComposer.swift');
  const originalBody = composer.slice(
    composer.indexOf('    private var sharedComposerContent: some View {'),
    composer.indexOf('    // iMessage shell:')
  );
  const imessageBody = composer.slice(
    composer.indexOf('    // iMessage shell:'),
    composer.indexOf('    private var controlRow: some View {')
  );

  assert.match(originalBody, /NativeLiveComposerTextInput\(/);
  assert.match(originalBody, /controlRow/);
  assert.match(originalBody, /\.glassEffect\(/);

  assert.match(imessageBody, /Text\("Message"\)/);
  assert.match(imessageBody, /TextField\(/);
  assert.match(imessageBody, /\.lineLimit\(1\.\.\.6\)/);
  assert.match(imessageBody, /\.background\(\.regularMaterial, in: RoundedRectangle/);
  assert.match(imessageBody, /private var iMessagePlusMenu: some View \{\s*Menu \{/);
  assert.match(imessageBody, /Label\("Model Settings", systemImage:/);
  for (const label of ['Photo', 'Camera', 'File', 'Call Claude']) {
    assert.ok(imessageBody.includes('Label("' + label + '"'), label);
  }
  for (const value of ['modelSelection', 'thinkingSelection', 'availableEffortLevels', '$effort']) {
    assert.ok(imessageBody.includes(value), value);
  }
  assert.match(imessageBody, /primaryActionButton/);
  assert.match(imessageBody, /\.disabled\(!canAttachFromIMessage\)/);
  assert.match(imessageBody, /\.disabled\(!canStartVoiceCall\)/);
  assert.match(imessageBody, /isFocused\.wrappedValue = false/);
});
