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
  assert.match(imessageBody, /\.glassEffect\(\.regular, in: Capsule\(\)\)/);
  assert.match(imessageBody, /\.glassEffect\(\.regular, in: Circle\(\)\)/);
  assert.doesNotMatch(imessageBody, /\.regularMaterial/);
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

test('iMessage uses a native safe-area inset with no opaque system bottom bar', () => {
  const chat = read('Chat/ChatView.swift');
  const composer = read('Chat/ChatComposer.swift');
  const placement = chat.slice(
    chat.indexOf('        .safeAreaInset(edge: .bottom) {'),
    chat.indexOf('        .sheet(isPresented: $isNativeCallPresented)')
  );
  const shared = chat.slice(chat.indexOf('    private var chatComposer: some View {'));

  assert.match(placement, /if selectedChatTheme == \.original/);
  assert.match(placement, /if selectedChatTheme == \.original[\s\S]*?\} else \{/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterHorizontal/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterTop/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterBottom/);
  assert.match(placement, /ChatPresentationLayout\.composerHiddenKeyboardPaintOffset/);
  assert.match(placement, /chatComposer\s*\.frame\(maxWidth: \.infinity\)\s*\.padding\(\.horizontal\)/);
  assert.doesNotMatch(placement, /safeAreaBar|ToolbarItem|\.background\(|\.regularMaterial/);

  assert.equal((chat.match(/\bChatComposer\(/g) ?? []).length, 1, 'exactly one composer callback owner');
  for (const route of [
    'text: $messageText',
    'model: $model',
    'thinking: $thinking',
    'effort: $effort',
    'attachments: composerAttachments',
    'onCancelEdit: cancelEditing',
    'onRetryAttachment: { id in',
    'onInterrupt: {',
    'onMidTurnInput: { text in',
    'onVoicePress: {',
    'onVoiceRelease: { voiceInput.release() }'
  ]) assert.ok(shared.includes(route), route);
  assert.match(shared, /sendMessage\(\)/);

  assert.match(composer, /case \.voice:\s*Image\(systemName: "waveform"\)/);
  assert.match(composer, /case \.send, \.midTurnSend, \.disabledSend:/);
  assert.match(composer, /\.background\(\.tint, in: Circle\(\)\)/);
  assert.match(composer, /case \.original:\s*sharedComposerContent/);
  assert.match(composer, /case \.iMessage:\s*iMessageComposerContent/);
});

test('Both chat themes use native interactive dismissal, including empty scroll surfaces', () => {
  const surface = read('Chat/NativeLiveMessageSurface.swift');
  assert.equal((surface.match(/\.scrollDismissesKeyboard\(\.interactively\)/g) ?? []).length, 2);
  assert.equal((surface.match(/\.scrollBounceBehavior\(\.always\)/g) ?? []).length, 2);
  assert.match(surface, /static func scrollableState<Content: View>/);
  assert.match(surface, /content\(\)\s*\.frame\(maxWidth: \.infinity, minHeight: geometry\.size\.height\)/);
  assert.equal((surface.match(/scrollableState \{/g) ?? []).length, 5);
  assert.doesNotMatch(surface, /DragGesture|resignFirstResponder|endEditing/);
  assert.match(read('Chat/ChatView.swift'), /if isDraftConversation && pendingOperation == nil \{\s*NativeLiveMessageSurface\.scrollableState \{ Color\.clear \}/);
});

test('Only iMessage text adopts split, mirrored bubbles and native typography', () => {
  const layout = read('Chat/ChatPresentationLayout.swift');
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const history = read('Chat/MessageSurface/NativeLiveHistoryMessageRow.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const actions = read('Chat/MessageSurface/NativeLiveMessageActions.swift');
  const markdown = read('Chat/MessageSurface/ChatMarkdown.swift');
  const math = read('Chat/MessageSurface/NativeLiveMathRenderer.swift');

  assert.match(layout, /iMessageUserLeadingClearance: CGFloat = 70/);
  assert.match(layout, /iMessageUserBubbleVerticalInset: CGFloat = 10/);
  assert.match(layout, /iMessageUserBubbleRadius: CGFloat = 20/);
  assert.doesNotMatch(layout, /iMessageUserBubbleMaxWidth/);
  assert.match(bubble, /ViewThatFits\(in: \.horizontal\)/);
  assert.match(bubble, /Color\.clear\.frame\(width:ChatPresentationLayout\.iMessageUserLeadingClearance\)/);
  assert.match(bubble, /side == \.outgoing \? Color\.blue : Color\.chatSoftFill/);
  assert.doesNotMatch(bubble, /iMessageUserBubbleMaxWidth/);

  // Each nonempty explicit line yields a separate visual segment, not a
  // rewritten canonical message or a flattened code/tool/attachment.
  assert.match(bubble, /rawText\.split\(whereSeparator: \\\.isNewline\)/);
  assert.match(bubble, /NativeLiveRichTextProjector\.project\(part\)/);
  assert.match(bubble, /if node\.kind == \.markdown && !node\.rendersInlineChildren && !node\.children\.isEmpty/);
  assert.match(bubble, /guard textNode, !isDivider else/);
  assert.match(bubble, /NativeLiveVisualNodeView\(node: segment\.node, role: presentation\.role\)/);
  assert.match(user, /NativeLiveIMessageTextBubbleList\(presentation: presentation, side: \.outgoing\)/);
  assert.match(assistant, /NativeLiveIMessageTextBubbleList\(\s*presentation: turn\.bodyPresentation,\s*side: \.incoming/);
  assert.match(history, /NativeLiveIMessageTextBubbleList\(presentation: presentation, side: \.outgoing\)/);
  assert.match(history, /NativeLiveIMessageTextBubbleList\(\s*presentation: presentation,\s*side: \.incoming/);

  // Original footer remains intact; no row-level context menu intercepts
  // thinking, tool controls, specialized blocks or links in iMessage mode.
  assert.match(assistant, /if chatTheme == \.original \{\s*nativeLiveAssistantActions\(/);
  assert.doesNotMatch(assistant, /content\.contextMenu/);
  assert.match(assistant, /guard turn\.canRetry, let userID = turn\.parentUserMessageID else \{ return nil \}/);
  assert.match(assistant, /onRetryMessage\(userID\)/);
  assert.match(assistant, /timestamp: turn\.visibleTimestamp\.map \{ MessageTimestampFormatter\.string\(from: \$0\) \}/);
  assert.match(assistant, /onCopy: onCopyMessage/);
  assert.match(assistant, /onRetry: retryAction/);
  assert.match(assistant, /isRetryDisabled: isTurnInFlight/);

  // Every assistant *text bubble*, not the whole row, receives the same
  // UIKit long-press interaction used by the user bubble.
  assert.match(bubble, /private struct NativeLiveIMessageAssistantTextBubble: View/);
  assert.match(bubble, /IMessageAssistantBubbleContextMenuInteraction\(/);
  assert.match(bubble, /\.overlay \{\s*IMessageAssistantBubbleContextMenuInteraction\(/);
  assert.match(bubble, /\.translationPresentation\(/);
  assert.match(bubble, /isPresented: \$showsTranslation/);
  assert.match(bubble, /text: plainText/);
  assert.doesNotMatch(bubble, /replacementAction:/);
  assert.match(actions, /struct IMessageAssistantBubbleContextMenuInteraction: UIViewRepresentable/);
  assert.match(actions, /UIContextMenuInteraction\(delegate: context\.coordinator\)/);
  assert.match(actions, /UIAction\(title: "Copy"/);
  assert.match(actions, /title: "Retry"/);
  assert.match(actions, /self\.isRetryDisabled \? \[\.disabled\] : \[\]/);
  assert.match(actions, /UIAction\(title: "Translate"/);
  assert.match(actions, /UIMenu\(title: stamp, options: \.displayInline, children: actions\)/);
  assert.match(history, /timeZoneIdentifier: timeZone/);
  assert.match(history, /UIPasteboard\.general\.string = text/);
  assert.match(history, /if chatTheme == \.iMessage \{[\s\S]*?\} else \{[\s\S]*?MessageTimestampFormatter\.string/);

  // Shared markdown renderers style only iMessage, leaving both roles'
  // Original fonts and extra line spacing unchanged.
  for (const source of [markdown, math]) {
    assert.match(source, /@Environment\(\\\.chatTheme\) private var chatTheme/);
    assert.match(source, /chatTheme == \.iMessage && \(role == "user" \|\| role == "assistant"\)/);
    assert.match(source, /\.font\(isIMessageBubbleText \? \.body : \.system\(size: 17\)\)/);
    assert.match(source, /\.lineSpacing\(isIMessageBubbleText \? 0 : \(role == "user" \? 5 : 6\)\)/);
  }
  assert.match(math, /verticalSpacing: 4/);
  assert.doesNotMatch(user, /\.tracking\(/);
});


test('iMessage alone uses compact spacing with tight native-line bubble wrapping', () => {
  const layout = read('Chat/ChatPresentationLayout.swift');
  const list = read('Chat/MessageSurface/NativeLiveMessageList.swift');
  const surface = read('Chat/NativeLiveMessageSurface.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');

  // Original retains its exact existing constants, including process
  // boundaries, while the iMessage-only paths select the new sizes.
  assert.match(layout, /turnSpacing: CGFloat = 25/);
  assert.match(layout, /processSectionSpacing: CGFloat = 18/);
  assert.match(layout, /assistantSpacing: CGFloat = 6/);
  assert.match(layout, /iMessageTurnSpacing: CGFloat = 12/);
  assert.match(layout, /iMessageTextBubbleSpacing: CGFloat = 8/);
  assert.match(layout, /iMessageProcessSectionSpacing: CGFloat = 10/);
  assert.match(list, /rowSpacing: CGFloat = ChatPresentationLayout\.turnSpacing/);
  assert.match(list, /LazyVStack\(spacing: rowSpacing\)/);
  assert.match(surface, /@Environment\(\\\.chatTheme\) private var chatTheme/);
  assert.match(surface, /rowSpacing: chatTheme == \.iMessage \? ChatPresentationLayout\.iMessageTurnSpacing : ChatPresentationLayout\.turnSpacing/);

  // In the same row's VStack, each of Thought→Worked, Worked→body, and
  // Thought→body is 6pt base spacing + 4pt conditional bottom inset.
  assert.match(assistant, /VStack\(alignment:\.leading,spacing:ChatPresentationLayout\.assistantSpacing\)/);
  assert.match(assistant, /processSections\.showsThinking && \(processSections\.showsActivity \|\| !turn\.bodyPresentation\.nodes\.isEmpty\) \? processSectionExtraSpacing : 0/);
  assert.match(assistant, /processSections\.showsActivity && !turn\.bodyPresentation\.nodes\.isEmpty \? processSectionExtraSpacing : 0/);
  assert.match(assistant, /chatTheme == \.iMessage \? ChatPresentationLayout\.iMessageProcessSectionSpacing : ChatPresentationLayout\.processSectionSpacing/);
  assert.match(assistant, /- ChatPresentationLayout\.assistantSpacing/);

  // Only remove the forced full-row background. The native Text view
  // still owns line breaking, and the same padding and max clearance apply.
  assert.match(bubble, /ViewThatFits\(in: \.horizontal\)/);
  assert.match(bubble, /bubble\(content\.fixedSize\(horizontal: true, vertical: false\)\)/);
  assert.match(bubble, /bubble\(content\.fixedSize\(horizontal: false, vertical: true\)\)/);
  assert.doesNotMatch(bubble, /IMessageTightBubbleLayout|fillAvailableWidth|\.frame\(maxWidth: \.infinity[\s\S]*?\.background\(/);
  assert.match(bubble, /NativeLiveIMessageAssistantTextBubble\([\s\S]*?\.frame\(maxWidth:\.infinity,alignment:\.leading\)/);
  assert.match(bubble, /Color\.clear\.frame\(width:ChatPresentationLayout\.iMessageUserLeadingClearance\)/);
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const rows = read('Chat/MessageSurface/NativeLiveMessageRows.swift');
  const history = read('Chat/MessageSurface/NativeLiveHistoryMessageRow.swift');
  assert.match(user, /if isIMessage && !user\.isVoiceInput/);
  assert.match(user, /Color\.clear\.frame\(width:leadingClearance\)/);
  assert.match(user, /messageView\.frame\(maxWidth:\.infinity,alignment:\.trailing\)/);
  assert.match(user, /Spacer\(minLength:leadingClearance\)/);
  assert.match(rows, /isIMessage: chatTheme == \.iMessage/);
  assert.match(history, /Color\.clear\.frame\(width: ChatPresentationLayout\.iMessageUserLeadingClearance\)/);
  assert.match(history, /Spacer\(minLength: ChatPresentationLayout\.userLeadingClearance\)/);
  assert.match(bubble, /alignment: side == \.outgoing \? \.trailing : \.leading/);
  assert.match(bubble, /spacing: ChatPresentationLayout\.iMessageTextBubbleSpacing/);
  assert.match(bubble, /22 - ChatPresentationLayout\.iMessageTextBubbleSpacing/);
  assert.match(bubble, /12 - ChatPresentationLayout\.iMessageTextBubbleSpacing/);
  assert.match(bubble, /rawText\.split\(whereSeparator:/);
  assert.doesNotMatch(bubble, /iMessageUserBubbleMaxWidth|300\s*pt|\.frame\(width:\s*300/);
});


test('iMessage bubbles use subtle translucency without changing geometry or hit targets', () => {
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const layout = read('Chat/ChatPresentationLayout.swift');

  assert.match(bubble, /LinearGradient\(/);
  assert.match(bubble, /Color\.blue\.opacity\(0\.95\), Color\.blue\.opacity\(0\.91\)/);
  assert.match(bubble, /Color\.chatSoftFill\.opacity\(0\.92\), Color\.chatSoftFill\.opacity\(0\.87\)/);
  assert.match(bubble, /Color\.white\.opacity\(0\.98\)/);
  assert.match(bubble, /Color\.primary\.opacity\(0\.96\)/);
  assert.match(bubble, /\.strokeBorder\(Color\.white\.opacity\(0\.12\), lineWidth: 0\.5\)/);
  assert.match(bubble, /\.allowsHitTesting\(false\)/);
  assert.doesNotMatch(bubble, /\.ultraThinMaterial|\.thinMaterial|\.glassEffect/);

  assert.match(bubble, /ViewThatFits\(in: \.horizontal\)/);
  assert.match(bubble, /\.padding\(\.horizontal, ChatPresentationLayout\.bubbleHorizontalInset\)/);
  assert.match(bubble, /\.padding\(\.vertical, ChatPresentationLayout\.iMessageUserBubbleVerticalInset\)/);
  assert.match(bubble, /IMessageAssistantBubbleContextMenuInteraction\(/);
  assert.match(bubble, /\.translationPresentation\(/);
  assert.match(user, /LightweightContextMenuInteraction\(/);
  assert.match(assistant, /onRetry: retryAction/);
  assert.match(layout, /iMessageTurnSpacing: CGFloat = 12/);
  assert.match(layout, /iMessageTextBubbleSpacing: CGFloat = 8/);
  assert.match(layout, /iMessageProcessSectionSpacing: CGFloat = 10/);
});
