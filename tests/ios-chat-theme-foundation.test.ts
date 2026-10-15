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

  assert.match(imessageBody, /Text\("Message"\)\s*\.foregroundStyle\(Color\.primary\.opacity\(0\.35\)\)/);
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
  // Move only the plus-to-input gap; keep its 42pt control and the
  // separate 8pt text-field-to-action gap unchanged.
  assert.match(imessageBody, /HStack\(alignment: \.bottom, spacing: 10\) \{\s*iMessagePlusMenu\s*HStack\(alignment: \.bottom, spacing: 8\)/);
  assert.match(imessageBody, /\.frame\(width: 42, height: 42\)/);
  assert.match(imessageBody, /\.frame\(minHeight: 42\)/);
  assert.match(imessageBody, /\.padding\(\.leading, 14\)/);
  assert.match(imessageBody, /\.disabled\(!canAttachFromIMessage\)/);
  assert.match(imessageBody, /\.disabled\(!canStartVoiceCall\)/);
  assert.match(imessageBody, /isFocused\.wrappedValue = false/);
});

test('iMessage uses a native safe-area inset with no opaque system bottom bar', () => {
  const chat = read('Chat/ChatView.swift');
  const composer = read('Chat/ChatComposer.swift');
  const page = read('Navigation/PageContainer.swift');
  const placement = chat.slice(
    chat.indexOf('        .safeAreaInset(edge: .bottom, spacing: selectedChatTheme == .iMessage ? 0 : nil) {'),
    chat.indexOf('        .sheet(isPresented: $isNativeCallPresented)')
  );
  const shared = chat.slice(chat.indexOf('    private var chatComposer: some View {'));
  assert.match(placement, /if selectedChatTheme == \.original/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterHorizontal/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterTop/);
  assert.match(placement, /ChatPresentationLayout\.composerOuterBottom/);
  assert.match(placement, /ChatPresentationLayout\.composerHiddenKeyboardPaintOffset/);
  assert.match(placement, /\.safeAreaInset\(edge: \.bottom, spacing: selectedChatTheme == \.iMessage \? 0 : nil\)/);
  assert.match(placement, /chatComposer\s*\.frame\(maxWidth: \.infinity\)\s*\.padding\(\.horizontal, 20\)\s*\.padding\(\.top, 8\)\s*\.padding\(\.bottom, isSystemKeyboardVisible \? 12 : 8\)\s*\.offset\(y: isSystemKeyboardVisible \? 0 : 10\)/);
  assert.doesNotMatch(placement, /safeAreaBar|ToolbarItem|\.background\(|\.regularMaterial/);
  assert.match(page, /if !iMessageWallpaperVisible \{\s*pageBackground\.ignoresSafeArea\(\)/);
  assert.match(page, /\.containerBackground\(\s*iMessageWallpaperVisible \? Color\.clear : pageBackground,\s*for: \.navigation\s*\)/);
  assert.equal((chat.match(/\bChatComposer\(/g) ?? []).length, 1);
  for (const route of [
    'text: $messageText', 'model: $model', 'thinking: $thinking',
    'effort: $effort', 'attachments: composerAttachments',
    'onCancelEdit: cancelEditing', 'onRetryAttachment: { id in',
    'onInterrupt: {', 'onMidTurnInput: { text in',
    'onVoicePress: {', 'onVoiceRelease: { voiceInput.release() }'
  ]) assert.ok(shared.includes(route), route);
  assert.match(shared, /sendMessage\(\)/);
  const action = composer.slice(
    composer.indexOf('    private var iMessageActionLabel: some View {'),
    composer.indexOf('    private var voiceActionButton: some View {')
  );
  assert.match(action, /case \.voice:\s*Image\(systemName: "waveform"\)\s*\.font\(\.system\(size: 18, weight: \.medium\)\)/);
  assert.match(composer, /\.opacity\(voiceEnabled \? 1 : 0\.35\)/);
  assert.match(action, /width: LeileiUI\.ControlGeometry\.compact,\s*height: LeileiUI\.ControlGeometry\.compact/);
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
  assert.match(bubble, /hex: side == \.outgoing \? outgoingColorHex : incomingColorHex/);
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


test('iMessage bubbles keep native blur while stronger flat tints restore vivid contrast', () => {
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const layout = read('Chat/ChatPresentationLayout.swift');

  assert.doesNotMatch(bubble, /LinearGradient\(/);
  assert.match(bubble, /IMessageBubbleAppearance\.color\(/);
  assert.match(bubble, /\.opacity\(side == \.outgoing \? outgoingOpacity : incomingOpacity\)/);
  assert.match(bubble, /\.fill\(tintColor\)/);
  assert.match(bubble, /Color\.white\.opacity\(0\.98\)/);
  assert.doesNotMatch(bubble, /Color\.primary\.opacity\(/);
  assert.doesNotMatch(bubble, /\.strokeBorder\(/);
  const paintedBubble = bubble.slice(
    bubble.indexOf('struct NativeLiveIMessageTextBubble<'),
    bubble.indexOf('// Each assistant text segment owns')
  );
  assert.doesNotMatch(paintedBubble, /\.overlay \{/);
  assert.match(bubble, /\.fill\(\.ultraThinMaterial\)/);
  assert.match(bubble, /\.environment\(\\\.colorScheme, \.dark\)/);
  assert.match(bubble, /\.allowsHitTesting\(false\)/);
  assert.doesNotMatch(bubble, /\.glassEffect\(|LinearGradient\(/);

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


test('a single local wallpaper serves every iMessage conversation without changing Original or messages', () => {
  const wallpaper = read('Chat/IMessageWallpaper.swift');
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const surface = read('Chat/NativeLiveMessageSurface.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  assert.match(wallpaper, /static let revisionKey = "chat\.imessage\.wallpaperRevision"/);
  assert.match(wallpaper, /applicationSupportDirectory/);
  assert.match(wallpaper, /wallpaper\.jpg/);
  assert.match(wallpaper, /maximumDimension: CGFloat = 2400/);
  assert.match(wallpaper, /jpegData\(withCompressionQuality: 0\.86\)/);
  assert.match(wallpaper, /\.write\(to: imageURL\(\), options: \.atomic\)/);
  assert.match(wallpaper, /static func load\(\) -> UIImage\?/);
  assert.match(wallpaper, /static func remove\(\) throws/);
  assert.doesNotMatch(wallpaper, /conversationId|conversationID|uploadNativeLiveAttachment/);
  assert.match(shell, /@AppStorage\(IMessageWallpaper\.revisionKey\) private var wallpaperRevision/);
  assert.match(shell, /\.task\(id: wallpaperRevision\) \{\s*shellWallpaperImage = IMessageWallpaper\.load\(\)/);
  assert.equal((shell.match(/Image\(uiImage: shellWallpaperImage\)/g) ?? []).length, 1);
  assert.match(shell, /\.ignoresSafeArea\(\.all\)/);
  assert.match(shell, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);
  assert.doesNotMatch(page, /Image\(uiImage: chatWallpaperImage\)|wallpaperRevision|chatWallpaperImage|IMessageWallpaper\.load/);
  assert.doesNotMatch(chat, /Image\(uiImage:|wallpaperRevision|wallpaperImage|IMessageWallpaper\.load/);
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)/);
  assert.match(surface, /\.background\(chatTheme == \.iMessage \? Color\.clear : Color\(\.systemBackground\)\)/);
  assert.match(settings, /if chatThemeRawValue == ChatTheme\.iMessage\.rawValue/);
  assert.match(settings, /PhotosPicker\(selection: \$wallpaperSelection, matching: \.images\)/);
  assert.match(settings, /try IMessageWallpaper\.save\(image\)/);
  assert.match(settings, /try IMessageWallpaper\.remove\(\)/);
  assert.match(settings, /wallpaperRevision = UUID\(\)\.uuidString/);
  assert.match(settings, /Restore Default Background/);
  assert.match(bubble, /ViewThatFits\(in: \.horizontal\)/);
});

test('only wallpaper-backed iMessage process headers get contrasting white labels', () => {
  const theme = read('Chat/ChatTheme.swift');
  const chat = read('Chat/ChatView.swift');
  const thinking = read('Chat/MessageSurface/NativeLiveVisibleThinkingSurface.swift');
  const activity = read('Chat/MessageSurface/NativeLiveRuntimeActivity.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');

  assert.match(theme, /private struct IMessageWallpaperVisibleKey: EnvironmentKey/);
  assert.match(theme, /static let defaultValue = false/);
  assert.match(theme, /var iMessageWallpaperVisible: Bool/);
  const shell = read('Navigation/AppShell.swift');
  assert.match(shell, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);

  for (const file of [thinking, activity]) {
    assert.match(file, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
    assert.match(file, /iMessageWallpaperVisible \? Color.white : Color.secondary/);
    assert.match(file, /iMessageWallpaperVisible \? Color.black.opacity\(0\.75\) : \.clear/);
  }
  assert.match(thinking, /Text\("Thought process"\)/);
  assert.match(activity, /Text\(header\)/);
  assert.match(activity, /expansion.toggleActivity\(\)/);
  assert.match(bubble, /\.fill\(\.ultraThinMaterial\)/);
  assert.doesNotMatch(bubble, /LinearGradient\(|\.strokeBorder\(/);
});


test('iMessage offers persisted, independent color and opacity controls for both bubble sides', () => {
  const appearance = read('Chat/IMessageBubbleAppearance.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');

  // Defaults correspond to the two colors just approved, and restore works.
  assert.match(appearance, /defaultOutgoingColorHex = "#008CFF"/);
  assert.match(appearance, /defaultIncomingColorHex = "#38424A"/);
  assert.match(appearance, /defaultOutgoingOpacity = 0\.88/);
  assert.match(appearance, /defaultIncomingOpacity = 0\.82/);
  assert.match(appearance, /outgoingColorKey = "chat\.imessage\.bubble\.outgoing\.color"/);
  assert.match(appearance, /incomingColorKey = "chat\.imessage\.bubble\.incoming\.color"/);
  assert.match(appearance, /outgoingOpacityKey = "chat\.imessage\.bubble\.outgoing\.opacity"/);
  assert.match(appearance, /incomingOpacityKey = "chat\.imessage\.bubble\.incoming\.opacity"/);
  assert.match(appearance, /static func color\(hex: String\) -> Color/);
  assert.match(appearance, /static func hex\(from color: Color\) -> String/);

  // Both sides use the same shared AppStorage keys as the settings view.
  for (const key of [
    'outgoingColorKey', 'incomingColorKey',
    'outgoingOpacityKey', 'incomingOpacityKey'
  ]) {
    assert.ok(bubble.includes('@AppStorage(IMessageBubbleAppearance.' + key + ')'), key);
    assert.ok(settings.includes('@AppStorage(IMessageBubbleAppearance.' + key + ')'), key);
  }
  assert.match(bubble, /\.fill\(tintColor\)/);
  assert.match(bubble, /\.fill\(\.ultraThinMaterial\)/);
  assert.match(bubble, /\.foregroundStyle\(Color\.white\.opacity\(0\.98\)\)/);
  assert.doesNotMatch(bubble, /LinearGradient\(|\.strokeBorder\(/);

  assert.match(settings, /if chatThemeRawValue == ChatTheme\.iMessage\.rawValue \{\s*Section\("iMessage Bubble Colors"\)/);
  assert.match(settings, /ColorPicker\(\s*"User Bubble Color",\s*selection: outgoingBubbleColorSelection,\s*supportsOpacity: false/);
  assert.match(settings, /ColorPicker\(\s*"Assistant Bubble Color",\s*selection: incomingBubbleColorSelection,\s*supportsOpacity: false/);
  assert.match(settings, /Slider\(value: \$outgoingBubbleOpacity, in: 0\.\.\.1, step: 0\.01\)/);
  assert.match(settings, /Slider\(value: \$incomingBubbleOpacity, in: 0\.\.\.1, step: 0\.01\)/);
  assert.match(settings, /outgoingBubbleColor = IMessageBubbleAppearance\.hex\(from: \$0\)/);
  assert.match(settings, /incomingBubbleColor = IMessageBubbleAppearance\.hex\(from: \$0\)/);
  assert.match(settings, /Button\("Restore Default Bubble Colors"\)/);
  assert.match(settings, /outgoingBubbleOpacity = IMessageBubbleAppearance\.defaultOutgoingOpacity/);
  assert.match(settings, /incomingBubbleOpacity = IMessageBubbleAppearance\.defaultIncomingOpacity/);
  assert.match(settings, /Opacity controls the color over native frosted glass/);
});


test('wallpaper-backed Tool and Tool result use composer-like glass and dark labels', () => {
  const tools = read('Chat/MessageSurface/NativeLiveToolActivity.swift');
  const composer = read('Chat/ChatComposer.swift');
  const theme = read('Chat/ChatTheme.swift');
  const chat = read('Chat/ChatView.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');

  // Use the same native regular glass as the input field, only when
  // wallpaper is actually visible. No dark solid fill, gradient or glow.
  assert.match(composer, /\.glassEffect\(\.regular, in: Capsule\(\)\)/);
  assert.match(theme, /static let defaultValue = false/);
  const shell = read('Navigation/AppShell.swift');
  assert.match(shell, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);
  assert.match(tools, /private struct NativeLiveToolWallpaperGlass: ViewModifier/);
  assert.match(tools, /if enabled \{\s*content\.glassEffect\(\s*\.regular,/);
  assert.match(tools, /else \{\s*content\s*\}/);
  assert.match(tools, /static let primary = Color\(red: 0\.17, green: 0\.20, blue: 0\.23\)/);
  assert.match(tools, /static let secondary = Color\.black\.opacity\(0\.64\)/);
  assert.match(tools, /static let tertiary = Color\.black\.opacity\(0\.48\)/);
  assert.doesNotMatch(tools, /NativeLiveToolWallpaperStyle\.background|LinearGradient\(|\.strokeBorder\(/);

  const call = tools.slice(
    tools.indexOf('struct NativeLiveToolCallCard: View'),
    tools.indexOf('struct NativeLiveToolResultCard: View')
  );
  const result = tools.slice(tools.indexOf('struct NativeLiveToolResultCard: View'));
  assert.match(call, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
  assert.match(call, /iMessageWallpaperVisible \? Color\.clear : Color\.primary\.opacity\(0\.045\)/);
  assert.match(call, /\.modifier\(NativeLiveToolWallpaperGlass\(enabled: iMessageWallpaperVisible\)\)/);
  assert.match(call, /NativeLiveToolWallpaperStyle\.primary/);
  assert.match(call, /HierarchicalShapeStyle\.primary/);
  assert.match(call, /HierarchicalShapeStyle\.secondary/);
  assert.match(call, /HierarchicalShapeStyle\.tertiary/);
  assert.match(call, /case \.running:\s*if iMessageWallpaperVisible \{/);
  assert.match(call, /\.sheet\(isPresented: \$isShowingDetails\)/);

  assert.match(result, /\.modifier\(NativeLiveToolWallpaperGlass\(enabled: iMessageWallpaperVisible\)\)/);
  assert.doesNotMatch(result, /\.background\s*\{|\.fill\(/);
  assert.match(result, /\.sheet\(isPresented: \$isShowingDetails\)/);
  assert.match(result, /NativeLiveToolWallpaperStyle\.secondary/);
  assert.match(result, /HierarchicalShapeStyle\.secondary/);
  assert.match(result, /HierarchicalShapeStyle\.tertiary/);

  // Original tool rows, details, bubble palette controls and spacing stay put.
  assert.match(result, /\.padding\(\.leading, 5\)/);
  assert.doesNotMatch(result, /\.padding\(\.vertical, 9\)/);
  assert.match(bubble, /\.fill\(tintColor\)/);
  assert.match(settings, /Slider\(value: \$outgoingBubbleOpacity, in: 0\.\.\.1/);
  assert.match(settings, /Slider\(value: \$incomingBubbleOpacity, in: 0\.\.\.1/);
});


test('iMessage scroll-to-latest stays inside viewport above composer while Original remains unchanged', () => {
  const surface = read('Chat/NativeLiveMessageSurface.swift');
  const layout = read('Chat/ChatPresentationLayout.swift');
  const chat = read('Chat/ChatView.swift');
  const viewport = surface.slice(
    surface.indexOf('    private func messageList('),
    surface.indexOf('    private func loadOlderButton(')
  );
  assert.match(viewport, /\.scrollClipDisabled\(chatTheme != \.iMessage\)/);
  assert.match(viewport, /\.overlay\(alignment: \.bottom\)/);
  assert.match(viewport, /scrollState\.shouldShowReturnToBottom/);
  assert.match(viewport, /\.padding\(\.bottom, chatTheme == \.iMessage \? 12 : 0\)/);
  assert.match(viewport, /\.offset\(y: chatTheme == \.iMessage \? 0 : ChatPresentationLayout\.scrollActionPaintOffset\)/);
  assert.match(viewport, /scrollState\.returnToBottom\(\)/);
  assert.match(viewport, /proxy\.scrollTo\(/);
  assert.match(layout, /scrollActionPaintOffset: CGFloat = 22/);
  assert.match(chat, /\.padding\(\.bottom, isSystemKeyboardVisible \? 12 : 8\)/);
});


test('single fixed wallpaper is independent of keyboard/composer reflow', () => {
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const composer = read('Chat/ChatComposer.swift');
  const root = shell.slice(shell.indexOf('    var body: some View {'), shell.indexOf('    private var isWallpaperChatVisible:'));
  assert.match(root, /Group \{/);
  assert.match(root, /iPadLayout\s*\.background \{ rootWallpaperBackdrop \}/);
  assert.match(shell, /if isWallpaperChatVisible, let shellWallpaperImage \{\s*GeometryReader/);
  assert.match(root, /Image\(uiImage: shellWallpaperImage\)/);
  assert.match(root, /\.ignoresSafeArea\(\.all\)/);
  assert.match(root, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);
  assert.match(root, /shellWallpaperImage = IMessageWallpaper\.load\(\)/);
  assert.match(page, /if !iMessageWallpaperVisible \{\s*pageBackground\.ignoresSafeArea\(\)/);
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)/);
  assert.doesNotMatch(page, /Image\(uiImage: chatWallpaperImage\)/);
  assert.doesNotMatch(chat, /Image\(uiImage:/);
  assert.match(chat, /\.padding\(\.bottom, isSystemKeyboardVisible \? 12 : 8\)/);
  assert.match(composer, /HStack\(alignment: \.bottom, spacing: 10\) \{\s*iMessagePlusMenu/);
});

test('shell renders exactly one wallpaper while child pages stay transparent', () => {
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const composer = read('Chat/ChatComposer.swift');
  const iphone = shell.slice(shell.indexOf('    private var iPhoneLayout: some View {'),shell.indexOf('    private func sidebarDragGesture('));
  assert.match(shell, /@AppStorage\(ChatTheme\.storageKey\) private var chatThemeRawValue/);
  assert.match(shell, /@AppStorage\(IMessageWallpaper\.revisionKey\) private var wallpaperRevision/);
  assert.match(shell, /\.task\(id: wallpaperRevision\) \{\s*shellWallpaperImage = IMessageWallpaper\.load\(\)/);
  assert.match(shell, /isWallpaperChatVisible: Bool \{/);
  assert.match(shell, /chatThemeRawValue == ChatTheme\.iMessage\.rawValue/);
  assert.match(shell, /shellWallpaperImage != nil/);
  assert.match(iphone, /ZStack\(alignment: \.leading\) \{\s*\/\/ The sidebar stays painted behind the chat/);
  assert.match(iphone, /Rectangle\(\)\s*\.fill\(sidebarBackground\)\s*\.ignoresSafeArea\(\)/);
  assert.match(iphone, /if isWallpaperChatVisible \{\s*rootWallpaperBackdrop\s*\}/);
  const sidebarIndex = iphone.indexOf('                SidebarView(');
  const wallpaperIndex = iphone.indexOf('                    rootWallpaperBackdrop', sidebarIndex);
  const pageIndex = iphone.indexOf('                PageContainer(', wallpaperIndex);
  assert.ok(
    sidebarIndex >= 0 && wallpaperIndex > sidebarIndex && pageIndex > wallpaperIndex,
    'iPhone wallpaper must paint after sidebar text and before transparent chat'
  );
  assert.equal((iphone.match(/rootWallpaperBackdrop/g) ?? []).length, 1);
  assert.doesNotMatch(iphone.slice(0, sidebarIndex), /rootWallpaperBackdrop/);
  assert.match(iphone, /PageContainer\(/);
  assert.match(iphone, /\.clipShape\(/);
  assert.equal((shell.match(/Image\(uiImage: shellWallpaperImage\)/g) ?? []).length, 1);
  assert.doesNotMatch(page, /Image\(uiImage: chatWallpaperImage\)|IMessageWallpaper\.load/);
  assert.doesNotMatch(chat, /Image\(uiImage:|IMessageWallpaper\.load/);
  assert.match(page, /if !iMessageWallpaperVisible \{\s*pageBackground\.ignoresSafeArea\(\)/);
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)/);
  assert.match(chat, /\.padding\(\.bottom, isSystemKeyboardVisible \? 12 : 8\)/);
  assert.match(chat, /\.offset\(y: isSystemKeyboardVisible \? 0 : 10\)/);
  assert.match(composer, /\.frame\(width: 42, height: 42\)/);
});

