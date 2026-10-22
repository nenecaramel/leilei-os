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

  assert.match(imessageBody, /TextField\(/);
  assert.match(imessageBody, /\.lineLimit\(1\.\.\.6\)/);
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
  assert.match(placement, /\.safeAreaInset\(edge: \.bottom, spacing: selectedChatTheme == \.iMessage \? 0 : nil\)/);
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

  assert.match(bubble, /hex: side == \.outgoing \? outgoingColorHex : incomingColorHex/);

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
  // The turn time left the long-press menu; it trails the turn's last text bubble.
  const assistantMenu = actions.slice(actions.indexOf('struct IMessageAssistantBubbleContextMenuInteraction'));
  assert.doesNotMatch(assistantMenu, /timestamp|stamp|displayInline/);
  // Only the turn's last text bubble carries the time, anchored to its text.
  assert.match(bubble, /let lastTextBubbleIndex = segments\.lastIndex\(where: \{ \$0\.isTextBubble \}\)/);
  assert.match(bubble, /timestamp: index == lastTextBubbleIndex \? timestamp : nil/);
  const assistantBubble = bubble.slice(bubble.indexOf('private struct NativeLiveIMessageAssistantTextBubble'), bubble.indexOf('struct NativeLiveIMessageTextBubbleList'));
  assert.match(assistantBubble, /NativeLiveVisualNodeView\(node: node, role: "assistant"\)\s*\.overlay\([^)]*\)\) \{\s*NativeLiveIMessageTrailingTimestamp\(text: timestamp\)/);
  assert.doesNotMatch(assistantBubble, /if let timestamp|if index ==/);
  const stamp = bubble.slice(bubble.indexOf('private struct NativeLiveIMessageTrailingTimestamp'));
  assert.match(stamp, /Text\(text \?\? ""\)/);
  assert.match(history, /timeZoneIdentifier: timeZone/);
  assert.match(history, /UIPasteboard\.general\.string = text/);
  assert.match(history, /if chatTheme == \.iMessage \{[\s\S]*?\} else \{[\s\S]*?MessageTimestampFormatter\.string/);

  // Shared markdown renderers branch on the theme for user/assistant text only.
  for (const source of [markdown, math]) {
    assert.match(source, /@Environment\(\\\.chatTheme\) private var chatTheme/);
    assert.match(source, /chatTheme == \.iMessage && \(role == "user" \|\| role == "assistant"\)/);
  }
});


test('theme-aware rows and process sections keep their routing and conditions', () => {
  const list = read('Chat/MessageSurface/NativeLiveMessageList.swift');
  const surface = read('Chat/NativeLiveMessageSurface.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');

  assert.match(list, /LazyVStack\(spacing: rowSpacing\)/);
  assert.match(surface, /@Environment\(\\\.chatTheme\) private var chatTheme/);

  // Extra process spacing applies only between sections that are present.
  assert.match(assistant, /processSections\.showsThinking && \(processSections\.showsActivity \|\| !turn\.bodyPresentation\.nodes\.isEmpty\) \? processSectionExtraSpacing : 0/);
  assert.match(assistant, /processSections\.showsActivity && !turn\.bodyPresentation\.nodes\.isEmpty \? processSectionExtraSpacing : 0/);

  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const rows = read('Chat/MessageSurface/NativeLiveMessageRows.swift');
  assert.match(user, /if isIMessage \{/);
  assert.match(rows, /isIMessage: chatTheme == \.iMessage/);
  assert.match(bubble, /rawText\.split\(whereSeparator:/);
});


test('iMessage bubble tint follows the stored settings and never intercepts touches', () => {
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const assistant = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');

  assert.match(bubble, /IMessageBubbleAppearance\.color\(/);
  assert.match(bubble, /\.opacity\(side == \.outgoing \? outgoingOpacity : incomingOpacity\)/);
  const paintedBubble = bubble.slice(
    bubble.indexOf('struct NativeLiveIMessageTextBubble<'),
    bubble.indexOf('// Each assistant text segment owns')
  );
  assert.doesNotMatch(paintedBubble, /\.overlay \{/);
  assert.match(bubble, /\.allowsHitTesting\(false\)/);

  assert.match(bubble, /IMessageAssistantBubbleContextMenuInteraction\(/);
  assert.match(bubble, /\.translationPresentation\(/);
  assert.match(user, /LightweightContextMenuInteraction\(/);
  assert.match(assistant, /onRetry: retryAction/);
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
  assert.equal((shell.match(/Image\(uiImage: image\)/g) ?? []).length, 1);
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
  }
  assert.match(thinking, /Text\("Thought process"\)/);
  assert.match(activity, /Text\(header\)/);
  assert.match(activity, /expansion.toggleActivity\(\)/);
});


test('iMessage offers persisted, independent color and opacity controls for both bubble sides', () => {
  const appearance = read('Chat/IMessageBubbleAppearance.swift');
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');

  // Stored keys and conversion helpers; default values are owner-tuned.
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
  assert.doesNotMatch(settings, /Opacity controls the color over native frosted glass/);
});


test('wallpaper-backed Tool and Tool result switch to their glass modifier only when wallpaper is visible', () => {
  const tools = read('Chat/MessageSurface/NativeLiveToolActivity.swift');
  const theme = read('Chat/ChatTheme.swift');
  const settings = read('Navigation/Settings/SettingsHomeContent.swift');

  // Glass applies only when wallpaper is actually visible.
  assert.match(theme, /static let defaultValue = false/);
  const shell = read('Navigation/AppShell.swift');
  assert.match(shell, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);
  assert.match(tools, /private struct NativeLiveToolWallpaperGlass: ViewModifier/);
  assert.match(tools, /else \{\s*content\s*\}/);

  const call = tools.slice(
    tools.indexOf('struct NativeLiveToolCallCard: View'),
    tools.indexOf('struct NativeLiveToolResultCard: View')
  );
  const result = tools.slice(tools.indexOf('struct NativeLiveToolResultCard: View'));
  assert.match(call, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
  assert.match(call, /\.modifier\(NativeLiveToolWallpaperGlass\(enabled: iMessageWallpaperVisible\)\)/);
  assert.match(call, /case \.running:\s*if iMessageWallpaperVisible \{/);
  assert.match(call, /\.sheet\(isPresented: \$isShowingDetails\)/);

  assert.match(result, /\.modifier\(NativeLiveToolWallpaperGlass\(enabled: iMessageWallpaperVisible\)\)/);
  assert.match(result, /\.sheet\(isPresented: \$isShowingDetails\)/);

  // Bubble palette controls stay available.
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
  assert.match(viewport, /scrollState\.returnToBottom\(\)/);
  assert.match(viewport, /proxy\.scrollTo\(/);
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
  assert.match(root, /Image\(uiImage: image\)/);
  assert.match(root, /\.ignoresSafeArea\(\.all\)/);
  assert.match(root, /\.environment\(\\\.iMessageWallpaperVisible, isWallpaperChatVisible\)/);
  assert.match(root, /shellWallpaperImage = IMessageWallpaper\.load\(\)/);
  assert.match(page, /if !iMessageWallpaperVisible \{\s*pageBackground\.ignoresSafeArea\(\)/);
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)/);
  assert.doesNotMatch(page, /Image\(uiImage: chatWallpaperImage\)/);
  assert.doesNotMatch(chat, /Image\(uiImage:/);
});

test('iMessage wallpaper and navigation compose in a single full-height sliding card', () => {
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const iphone = shell.slice(shell.indexOf('    private var iPhoneLayout: some View {'),
                             shell.indexOf('    private func sidebarDragGesture('));
  const sidebar = iphone.indexOf('                SidebarView(');
  const composite = iphone.indexOf('                ZStack(alignment: .topLeading) {', sidebar);
  const wallpaper = iphone.indexOf('                        wallpaperImage(', composite);
  const navigation = iphone.indexOf('                    PageContainer(', wallpaper);
  assert.ok(sidebar >= 0 && composite > sidebar && wallpaper > composite && navigation > wallpaper);
  assert.equal((iphone.match(/wallpaperImage\(/g) ?? []).length, 1);
  assert.equal((shell.match(/Image\(uiImage: image\)/g) ?? []).length, 1);
  assert.equal((iphone.match(/\.offset\(x: pageHorizontalOffset\)/g) ?? []).length, 1);
  assert.match(iphone, /\.clipShape\(SidebarRevealCardMask\(progress: revealProgress\)\)/);
  assert.match(iphone, /\.frame\(\s*width: fullViewport\.width,\s*height: fullViewport\.height,\s*alignment: \.topLeading\s*\)/);
  assert.match(page, /iMessageWallpaperVisible \? Color\.clear : pageBackground/);
  assert.match(page, /if !iMessageWallpaperVisible \{\s*pageBackground\.ignoresSafeArea\(\)/);
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)/);
  assert.doesNotMatch(iphone.slice(0, composite), /rootWallpaperBackdrop\s*\.offset/);
  // The unrelated destructive trash icon uses Image(uiImage:); scope the wallpaper
  // ownership check to the navigation canvas, not every helper in the file.
  const pageCanvas = page.slice(page.indexOf('    var body: some View {'), page.indexOf('    private var conversationMenu: some View {'));
  assert.doesNotMatch(pageCanvas, /Image\(uiImage:|IMessageWallpaper\.load/);
  assert.doesNotMatch(chat, /Image\(uiImage:|IMessageWallpaper\.load/);
});

test('sidebar animation uses the same continuous progress for position and rounded mask', () => {
  const shell = read('Navigation/AppShell.swift');
  const iphone = shell.slice(shell.indexOf('    private var iPhoneLayout: some View {'),
                             shell.indexOf('    private func sidebarDragGesture('));
  const mask = shell.slice(shell.indexOf('private struct SidebarRevealCardMask: Shape'),
                           shell.indexOf('struct AppShell: View {'));
  assert.match(iphone, /let pageHorizontalOffset = \(menuOpen \? revealOffset : 0\)\s*\+ sidebarDragTranslation/);
  assert.match(iphone, /let revealProgress = hasPinnedChatBackdrop\s*\? max\(0, min\(1, pageHorizontalOffset \/ revealOffset\)\)\s*: \(menuOpen \? 1 : 0\)/);
  assert.match(iphone, /\.clipShape\(SidebarRevealCardMask\(progress: revealProgress\)\)/);
  assert.match(mask, /var animatableData: CGFloat/);
  assert.match(mask, /let radius = 50 \* min\(max\(progress, 0\), 1\)/);
  assert.doesNotMatch(iphone, /menuOpen \? 50 : 0/);
  assert.equal((iphone.match(/\.offset\(x: pageHorizontalOffset\)/g) ?? []).length, 1);
  assert.match(iphone, /Rectangle\(\)\s*\.fill\(sidebarBackground\)/);
});

test('iMessage rich structured content shares one wallpaper-aware panel across renderers', () => {
  const source = read('Chat/MessageSurface/NativeLiveCodeRenderer.swift');
  const visual = read('Chat/MessageSurface/NativeLiveVisualSurface.swift');
  const svg = read('Chat/MessageSurface/NativeLiveSVGRenderer.swift');
  const structured = read('Chat/MessageSurface/NativeLiveStructuredToolResultRenderer.swift');
  const search = read('Chat/MessageSurface/NativeLiveSearchCitationRenderer.swift');
  const blocks = read('Chat/MessageSurface/NativeLiveMessageBlocks.swift');
  const table = read('Chat/MessageSurface/NativeLiveTableRenderer.swift');
  const diff = read('Chat/MessageSurface/NativeLiveDiffRenderer.swift');
  const math = read('Chat/MessageSurface/NativeLiveMathRenderer.swift');
  const tool = read('Chat/MessageSurface/NativeLiveToolActivity.swift');

  // Every rich renderer goes through one wallpaper-aware panel modifier.
  assert.match(tool, /NativeLiveToolWallpaperGlass: ViewModifier/);
  assert.match(source, /struct NativeLiveIMessageContentPanel: ViewModifier/);
  assert.match(source, /@Environment\(\\\.iMessageWallpaperVisible\) private var iMessageWallpaperVisible/);
  assert.match(source, /if iMessageWallpaperVisible \{/);

  // Code, table, diff and LaTeX fallback share one source panel. Keep
  // scrolling, copy and column alignment.
  assert.match(source, /struct NativeLiveSourcePanel<Content: View>: View/);
  assert.match(source, /\.modifier\(NativeLiveIMessageContentPanel\(/);
  assert.match(source, /ScrollView\(\[\.horizontal, \.vertical\]\)/);
  assert.match(source, /UIPasteboard\.general\.string = copyText/);
  assert.match(table, /NativeLiveSourcePanel\(label: "Table"/);
  assert.match(table, /alignment\(column\)/);
  assert.match(diff, /NativeLiveSourcePanel\(label: "Diff"/);
  assert.match(math, /NativeLiveSourcePanel\(/);

  // Display math and Mermaid share one visual panel; an embedded renderer
  // tells its sandbox it sits inside the parent panel.
  assert.match(visual, /private var regularSurface: some View/);
  assert.match(visual, /\.modifier\(NativeLiveIMessageContentPanel\(/);
  assert.match(visual, /NativeLiveVisualSandbox\(/);
  assert.match(visual, /var embeddedInParentPanel = false/);
  assert.match(visual, /embeddedInGlass: embeddedInParentPanel/);
  assert.match(svg, /embeddedInParentPanel:true/);
  assert.match(svg, /\.modifier\(NativeLiveIMessageContentPanel\(/);

  // JSON/structured result/search/future unknown nodes use the same panel.
  assert.match(structured, /struct NativeLiveStructuredToolResultView: View/);
  assert.match(structured, /struct NativeLiveStructuredJSONView: View/);
  assert.equal((structured.match(/\.modifier\(NativeLiveIMessageContentPanel\(/g) ?? []).length, 2);
  assert.match(search, /NativeLiveSearchResultView: View/);
  assert.match(search, /\.modifier\(NativeLiveIMessageContentPanel\(/);
  assert.match(blocks, /private struct NativeLiveVisualFallbackView: View/);
  assert.match(blocks, /\.modifier\(NativeLiveIMessageContentPanel\(/);

  // Plain message text, image galleries, media and the existing Tool-list UI
  // aren't wrapped in an extra panel.
  const visualNode = blocks.slice(
    blocks.indexOf('struct NativeLiveVisualNodeView: View'),
    blocks.indexOf('private struct NativeLiveVisualFallbackView: View')
  );
  assert.doesNotMatch(visualNode, /\.glassEffect\(|\.modifier\(NativeLiveIMessageContentPanel/);
  assert.match(tool, /private struct NativeLiveToolWallpaperGlass: ViewModifier/);
});


test('ordinary file and Spotify cards reuse wallpaper-only iMessage glass without changing Original or media actions', () => {
  const media = read('Chat/MessageSurface/NativeLiveMediaRenderer.swift');
  const spotify = read('Chat/MessageSurface/NativeLiveSpotifyCard.swift');
  const shared = read('Chat/MessageSurface/NativeLiveCodeRenderer.swift');

  assert.match(media, /if input\.mediaKind == \.file \{/);
  assert.match(media, /fileLabelContent\s*\.modifier\(NativeLiveIMessageContentPanel\(/);
  assert.match(media, /Button \{ open\(\) \} label: \{ fileLabel \}/);
  assert.match(media, /NativeLiveAudioAttachmentBubble\(input: input\)/);
  assert.match(media, /\.fullScreenCover\(item:\$ownGallery\)/);

  assert.match(spotify, /\.modifier\(NativeLiveIMessageContentPanel\(/);
  assert.match(spotify, /if let url = entity\.url \{ openURL\(url\) \}/);
  assert.match(spotify, /NativeLiveToolDetailSheet\(/);
  assert.match(shared, /if iMessageWallpaperVisible \{/);
  assert.match(shared, /else if originalOpacity > 0 \{\s*content\.background\(/);
});

test('iMessage voice-to-text reuses the outgoing text bubble and its stored appearance', () => {
  const user = read('Chat/MessageSurface/NativeLiveUserMessageRow.swift');
  const shared = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');

  // Typed and voice user messages share one row layout.
  assert.doesNotMatch(user, /if isIMessage && !user\.isVoiceInput/);

  // Voice is nested in the same AppStorage-backed outgoing bubble as text,
  // so user-chosen color and opacity always update both without duplication.
  assert.match(user, /if presentation\.isVoiceInput \{\s*iMessageVoiceBubble/);
  assert.match(user, /private var iMessageVoiceBubble: some View \{\s*NativeLiveIMessageTextBubble\(side: \.outgoing, fitsContent: false\)/);
  assert.match(shared, /@AppStorage\(IMessageBubbleAppearance\.outgoingColorKey\)/);
  assert.match(shared, /@AppStorage\(IMessageBubbleAppearance\.outgoingOpacityKey\)/);
  assert.match(shared, /\.opacity\(side == \.outgoing \? outgoingOpacity : incomingOpacity\)/);

  const voiceSurface = user.slice(user.indexOf('private var iMessageVoiceBubble: some View'), user.indexOf('private var usesCompactVoiceInsets: Bool'));
  assert.match(voiceSurface, /Image\(systemName: "waveform"\)/);
  assert.match(voiceSurface, /"chevron\.up" : "chevron\.down"/);
  assert.match(voiceSurface, /NativeLiveVisualNodesView\(nodes: presentation\.textNodes, role: presentation\.role\)/);

  // Collapsed voice grows with the transcript up to the row's offered width.
  assert.match(voiceSurface, /userWidth\(transcript: presentation\.copyText/);
  assert.match(user, /onTap:toggleVoice/);
  assert.match(user, /isVoiceTranscriptRevealed\.toggle\(\)/);
});


test('iMessage assistant audio attachment and ElevenLabs share the incoming bubble backdrop and keep their actions', () => {
  const bubble = read('Chat/MessageSurface/NativeLiveIMessageTextBubbles.swift');
  const audio = read('Chat/MessageSurface/NativeLiveAudioAttachmentBubble.swift');
  const eleven = read('Chat/MessageSurface/NativeLiveElevenLabsResultSurface.swift');

  // Text and audio reuse one visual backdrop and the same stored assistant
  // color/opacity; there are no hardcoded audio-specific background colors.
  assert.match(bubble, /struct NativeLiveIMessageBubbleBackdrop: View/);
  assert.match(bubble, /@AppStorage\(IMessageBubbleAppearance\.incomingColorKey\)/);
  assert.match(bubble, /@AppStorage\(IMessageBubbleAppearance\.incomingOpacityKey\)/);
  assert.match(bubble, /NativeLiveIMessageBubbleBackdrop\(side: side\)/);
  assert.match(bubble, /NativeLiveIMessageBubbleBackdrop\(side: \.incoming\)/);

  for (const surface of [audio, eleven]) {
    assert.match(surface, /@Environment\(\\\.chatTheme\) private var chatTheme/);
    assert.match(surface, /\.modifier\(NativeLiveAssistantAudioBubbleBackground\(\)\)/);
    assert.match(surface, /\.onDisappear \{ playback\.deactivate\(\) \}/);
    assert.match(surface, /Button \{ playOrPause\(\) \}/);
    assert.match(surface, /Button \{ open\(\) \}/);
    assert.match(surface, /Button\("Retry"\) \{ retry\(\) \}/);
  }
});

test('the generating-state line is theme-aware and the Thought glyph stays off the Worked for row', () => {
  const row = read('Chat/MessageSurface/NativeLiveAssistantTurnRow.swift');
  const thinking = read('Chat/MessageSurface/NativeLiveVisibleThinkingSurface.swift');
  const activity = read('Chat/MessageSurface/NativeLiveRuntimeActivity.swift');
  assert.match(row, /if chatTheme == \.iMessage \{\s*\/\/ A waiting state is a status/);
  assert.match(row, /NativeLiveProcessStatusHeadline\(/);
  assert.match(row, /else \{\s*Text\("Thinking\.\.\."\)/);
  assert.match(thinking, /struct NativeLiveProcessStatusHeadline: View/);
  assert.match(thinking, /NativeLiveThoughtProcessIcon\(\)/);
  const workHeader = activity.slice(activity.indexOf('    var body: some View {'), activity.indexOf('            if effectiveExpanded {'));
  assert.doesNotMatch(workHeader, /NativeLiveThoughtProcessIcon\(\)|Image\(systemName:\s*"clock"\)/);
});

test('iMessage bubble text takes the bubble palette; other text keeps the shared markdown', () => {
  const markdown = read('Chat/MessageSurface/ChatMarkdown.swift');
  const math = read('Chat/MessageSurface/NativeLiveMathRenderer.swift');
  assert.match(markdown, /Text\(\s*isIMessageBubbleText\s*\? NativeLiveIMessageMarkdownPalette\.inline\(model\.inline, isQuote: isQuote\)\s*: model\.inline/);
  assert.match(math, /NativeLiveIMessageMarkdownPalette\.inline\(markdown\.inline, isQuote: isQuote\)/);
  for (const source of [markdown, math]) {
    assert.match(source, /chatTheme == \.iMessage && \(role == "user" \|\| role == "assistant"\)/);
  }
});

test('keyboard changes chat height but not photo viewport, page mask, or iPad background', () => {
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const iphone = shell.slice(shell.indexOf('    private var iPhoneLayout: some View {'),
                             shell.indexOf('    private func sidebarDragGesture('));
  assert.match(shell, /@State private var iPhoneFullViewport = CGSize\.zero/);
  assert.match(shell, /private func fullIPhoneViewport\(for proposed: CGSize\) -> CGSize/);
  assert.match(shell, /abs\(proposed\.width - iPhoneFullViewport\.width\) < 1/);
  assert.match(shell, /height: max\(proposed\.height, iPhoneFullViewport\.height\)/);
  assert.match(iphone, /let fullViewport = hasPinnedChatBackdrop\s*\? fullIPhoneViewport\(for: proxy\.size\)\s*: proxy\.size/);
  assert.match(iphone, /wallpaperImage\(shellWallpaperImage, size: fullViewport\)/);
  assert.match(iphone, /\.frame\(width: proxy\.size\.width, height: proxy\.size\.height\)/);
  assert.match(iphone, /\.frame\(\s*width: fullViewport\.width,\s*height: fullViewport\.height,\s*alignment: \.topLeading\s*\)\s*\.clipShape\(SidebarRevealCardMask\(progress: revealProgress\)\)/);
  assert.match(iphone, /\.onChange\(of: proxy\.size\) \{ _, size in\s*rememberIPhoneViewport\(size\)/);
  assert.match(shell, /iPadLayout\s*\.background \{ rootWallpaperBackdrop \}/);
  assert.match(shell, /rootWallpaperBackdrop: some View \{\s*if isWallpaperChatVisible, let shellWallpaperImage \{\s*GeometryReader/);
  assert.match(shell, /\.ignoresSafeArea\(\.all\)/);
  assert.match(chat, /\.safeAreaInset\(edge: \.bottom, spacing: selectedChatTheme == \.iMessage \? 0 : nil\)/);
  assert.match(page, /iMessageWallpaperVisible \? Color\.clear : pageBackground/);
  assert.doesNotMatch(iphone, /\.ignoresSafeArea\(\.keyboard\)/);
  assert.equal((iphone.match(/\.offset\(x: pageHorizontalOffset\)/g) ?? []).length, 1);
});

test('Original chat uses the same fixed-height canvas below keyboard without adding a second wallpaper', () => {
  const shell = read('Navigation/AppShell.swift');
  const page = read('Navigation/PageContainer.swift');
  const chat = read('Chat/ChatView.swift');
  const iphone = shell.slice(shell.indexOf('    private var iPhoneLayout: some View {'),
                             shell.indexOf('    private func sidebarDragGesture('));
  const card = iphone.slice(iphone.indexOf('                ZStack(alignment: .topLeading) {'),
                            iphone.indexOf('                .clipShape(SidebarRevealCardMask('));

  assert.match(shell, /private var isOriginalChat: Bool \{\s*selectedPage == \.chat\s*&& chatThemeRawValue == ChatTheme\.original\.rawValue/);
  assert.match(iphone, /let hasPinnedChatBackdrop = isWallpaperChatVisible \|\| isOriginalChat/);
  assert.match(iphone, /let fullViewport = hasPinnedChatBackdrop\s*\? fullIPhoneViewport\(for: proxy\.size\)\s*: proxy\.size/);
  assert.match(iphone, /let revealProgress = hasPinnedChatBackdrop\s*\? max\(0, min\(1, pageHorizontalOffset \/ revealOffset\)\)/);
  assert.match(card, /if isOriginalChat \{\s*Color\(\.systemBackground\)\s*\.frame\(\s*width: fullViewport\.width,\s*height: fullViewport\.height\s*\)\s*\.allowsHitTesting\(false\)/);
  assert.match(card, /if isWallpaperChatVisible, let shellWallpaperImage \{\s*wallpaperImage\(shellWallpaperImage, size: fullViewport\)/);
  assert.match(card, /PageContainer\(/);
  assert.equal((iphone.match(/\.offset\(x: pageHorizontalOffset\)/g) ?? []).length, 1);
  assert.equal((shell.match(/Image\(uiImage: image\)/g) ?? []).length, 1);
  // Original foreground colors, safe-area composer placement, and navigation
  // remain unchanged; only a matching full-screen system-color underlay is new.
  assert.match(chat, /if !iMessageWallpaperVisible \{\s*Color\(\.systemBackground\)\s*\.ignoresSafeArea\(\)/);
  assert.match(page, /iMessageWallpaperVisible \? Color\.clear : pageBackground/);
  assert.match(chat, /\.safeAreaInset\(edge: \.bottom, spacing: selectedChatTheme == \.iMessage \? 0 : nil\)/);
  assert.match(shell, /iPadLayout\s*\.background \{ rootWallpaperBackdrop \}/);
});
