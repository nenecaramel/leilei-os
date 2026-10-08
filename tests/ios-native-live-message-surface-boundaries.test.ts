import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootPath =
  "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift";
const markdownPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/ChatMarkdown.swift";
const timestampPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/MessageTimestampFormatter.swift";

function readExisting(path: string): string {
  assert.equal(
    fs.existsSync(path),
    true,
    `expected extracted source file to exist: ${path}`,
  );
  return fs.readFileSync(path, "utf8");
}

test("chat markdown presentation is extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");
  const markdown = readExisting(markdownPath);

  assert.match(markdown, /struct ChatMarkdownView: View/);
  assert.match(markdown, /struct NativeLiveMarkdownRenderer: View/);
  assert.match(markdown, /NativeLiveMarkdownPresentation\.inline/);
  assert.doesNotMatch(markdown, /enum ChatMarkdownBlock|enum ChatMarkdownParser/);

  assert.doesNotMatch(root, /struct ChatMarkdownView: View/);
  assert.doesNotMatch(root, /struct NativeLiveMarkdownRenderer: View/);
  assert.doesNotMatch(root, /ChatMarkdownParser/);
});

test("message timestamp formatting is extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(timestampPath), true);
  const timestamp = readExisting(timestampPath);

  assert.match(timestamp, /enum MessageTimestampFormatter/);
  assert.doesNotMatch(root, /enum MessageTimestampFormatter/);
});

const actionsPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageActions.swift";

test("message actions are extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(actionsPath), true);
  const actions = readExisting(actionsPath);

  assert.match(actions, /struct LightweightContextMenuInteraction/);
  assert.match(actions, /final class Coordinator/);
  assert.match(actions, /title: "Copy"/);
  assert.match(actions, /title: self\.title/);
  assert.match(actions, /UITapGestureRecognizer\(/);
  assert.match(actions, /@objc func handleTap\(\)/);

  assert.doesNotMatch(root, /struct LightweightContextMenuInteraction/);
});

const interactionsPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveInteractions.swift";

test("runtime interactions are extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(interactionsPath), true);
  const interactions = readExisting(interactionsPath);

  assert.match(interactions, /struct NativeLivePermissionInteractionCard/);
  assert.match(interactions, /struct NativeLiveQuestionInteractionCard/);
  assert.match(interactions, /try await onResolve\(\s*interaction,\s*response\s*\)/);
  assert.match(interactions, /@State private var isSubmitting = false/);

  assert.doesNotMatch(root, /struct NativeLivePermissionInteractionCard/);
  assert.doesNotMatch(root, /struct NativeLiveQuestionInteractionCard/);
});

const runtimeActivityPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveRuntimeActivity.swift";
const runtimeActivityProjectionPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveTurnActivityProjection.swift";
const runtimeActivityLifecyclePath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveTurnActivityProjection+Lifecycle.swift";
const runtimeActivityToolsPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveTurnActivityProjection+Tools.swift";
const runtimeActivityTasksPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveTurnActivityProjection+Tasks.swift";
const runtimeModelsPath =
  "ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift";

test("runtime activity and tool presentation are extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  for (const path of [
    runtimeActivityPath,
    runtimeActivityProjectionPath,
    runtimeActivityLifecyclePath,
    runtimeActivityToolsPath,
    runtimeActivityTasksPath,
  ]) {
    assert.equal(fs.existsSync(path), true, path);
  }

  const runtimeFiles = [
    runtimeActivityPath,
    "NativeLiveTaskActivity.swift",
    "NativeLiveToolActivity.swift",
    "NativeLiveRuntimeInteractions.swift",
    "NativeLiveActivitySheets.swift",
    "NativeLiveToolPresentation.swift",
  ].map((path) =>
    path.startsWith("ios/")
      ? path
      : runtimeActivityPath.replace("NativeLiveRuntimeActivity.swift", path)
  );
  const runtime = runtimeFiles.map(readExisting).join("\n");
  const projection = readExisting(runtimeActivityProjectionPath);
  const lifecycleProjection = readExisting(runtimeActivityLifecyclePath);
  const toolProjection = readExisting(runtimeActivityToolsPath);
  const taskProjection = readExisting(runtimeActivityTasksPath);

  for (const symbol of [
    "struct NativeLiveTurnActivityView",
    "struct NativeLiveLifecycleActivityRow",
    "struct NativeLiveTaskActivityRow",
    "struct NativeLiveTaskResourceRow",
    "struct NativeLiveToolActivityRow",
    "enum NativeLiveToolCallState",
    "struct NativeLiveToolCallCard",
    "struct NativeLiveToolResultCard",
    "struct NativeLiveToolDetailSheet",
  ]) {
    assert.match(runtime, new RegExp(symbol));
    assert.doesNotMatch(root, new RegExp(symbol));
  }

  assert.match(projection, /struct NativeLiveTurnActivityProjection/);
  assert.doesNotMatch(runtime, /struct NativeLiveTurnActivityProjection/);
  assert.doesNotMatch(root, /struct NativeLiveTurnActivityProjection/);

  for (const contract of [
    /childTools/,
    /topLevelTools/,
    /permissionInteractions/,
    /topLevelInteractions/,
    /pendingInteractionIDs/,
    /hasActiveBackgroundTask/,
    /activityCount/,
    /summaryLabel/,
  ]) {
    assert.match(projection, contract);
  }

  assert.match(lifecycleProjection, /api_retry/);
  assert.match(lifecycleProjection, /command_lifecycle/);
  assert.match(toolProjection, /tool_use_id/);
  assert.match(toolProjection, /parent_tool_use_id/);
  assert.match(toolProjection, /hidden_from_transcript/);
  assert.match(toolProjection, /hidden_from_activity/);
  assert.match(toolProjection, /resource_links/);
  assert.match(taskProjection, /task_id/);
  assert.match(taskProjection, /is_backgrounded/);
  assert.match(taskProjection, /ambient/);
  assert.match(taskProjection, /resource_links/);

  assert.match(runtime, /Text\(header\)/);
  assert.match(runtime, /let timestampText: String\?/);
  assert.match(runtime, /let murmurText: String\?/);
  assert.match(runtime, /Image\(systemName: "bubble\.left"\)/);
  assert.match(runtime, /"chevron\.right"/);
  assert.match(runtime, /"chevron\.down"/);
  assert.match(runtime, /"mcp__leileios__get_diary": "Read Diary"/);
  assert.doesNotMatch(runtime, /mcp__leileios_album__/);
  assert.match(runtime, /"mcp__leileios_local__send_file": "Send File"/);

  const runtimeModels = readExisting(runtimeModelsPath);
  assert.doesNotMatch(runtimeModels, /var activityText:/);
  assert.doesNotMatch(root, /NativeLiveTurnActivityView/);
});

const mediaPresentationPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaPresentation.swift";
const mediaRendererPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMediaRenderer.swift";
const attachmentCachePath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAttachmentCache.swift";
const filePreviewPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveFilePreviewLifecycle.swift";

test("current attachment presentation is extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");
  const presentation = readExisting(mediaPresentationPath);
  const renderer = readExisting(mediaRendererPath);
  const cache = readExisting(attachmentCachePath);
  const preview = readExisting(filePreviewPath);

  assert.match(presentation, /enum NativeLiveMediaKind/);
  assert.match(presentation, /enum NativeLiveMediaError/);
  assert.match(presentation, /func cacheKey\(scope: String\)/);
  assert.match(renderer, /struct NativeLiveMediaRenderer: View/);
  assert.match(renderer, /struct NativeLiveMediaCard: View/);
  assert.match(renderer, /appModel\.nativeLiveAttachmentBytes\(input\)/);
  assert.match(cache, /enum NativeLiveAttachmentIntegrity/);
  assert.match(cache, /SHA256\.hash\(data:data\)/);
  assert.match(cache, /actor NativeLiveAttachmentBytesCache/);
  assert.match(preview, /final class NativeLiveFilePreviewLease/);
  assert.match(preview, /func cleanup\(\)/);

  for (const symbol of [
    "NativeLiveMediaRenderer",
    "NativeLiveMediaCard",
    "NativeLiveAttachmentBytesCache",
    "NativeLiveFilePreviewLease",
  ]) {
    assert.doesNotMatch(
      root,
      new RegExp("(?:struct|actor|final class) " + symbol),
    );
  }
});

const messageRowsPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageRows.swift";
const messageBlocksPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageBlocks.swift";

test("canonical voice input is a tappable compact bubble that expands and collapses its transcript", () => {
  const userRow = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveUserMessageRow.swift",
  );
  const presentation = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessagePresentation.swift",
  );

  assert.match(
    presentation,
    /payload: inputMode == \.voice \? \["input_mode": \.string\("voice"\)\] : nil/,
  );
  assert.match(
    presentation,
    /var isVoiceInput: Bool \{[\s\S]*role == "user"[\s\S]*\$0\.inputMode == "voice"/,
  );

  assert.match(userRow, /struct NativeLiveUserMessagePresentationView: View/);
  assert.match(userRow, /presentation\.isVoiceInput/);
  assert.match(userRow, /struct NativeLiveVoiceMessageBubbleVisual: View/);
  assert.match(userRow, /Image\(systemName: "waveform"\)/);
  assert.match(userRow, /NativeLiveVoiceBubbleGeometry\.userWidth/);
  assert.match(userRow, /NativeLiveVoiceBubbleGeometry\.contentHeight/);
  assert.match(userRow, /onTap:toggleVoice/);
  assert.match(userRow, /isVoiceTranscriptRevealed\.toggle\(\)/);
  assert.match(
    userRow,
    /get:\{ appModel\.nativeLiveMessageUIState\[row\.id\]\.voiceTranscriptExpansion \}/,
  );
  assert.doesNotMatch(userRow, /durationSeconds|duration_seconds|秒/);
  assert.doesNotMatch(userRow, /Text\([^)]*"[^"]*seconds[^"]*"/i);
});

test("message rows and canonical block rendering are extracted while root composition stays put", () => {
  const root = fs.readFileSync(rootPath, "utf8");
  const rows = readExisting(messageRowsPath);
  const blocks = readExisting(messageBlocksPath);
  const assistant = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAssistantTurnRow.swift",
  );
  const user = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveUserMessageRow.swift",
  );
  const history = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveHistoryMessageRow.swift",
  );
  const divider = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveHistoryDivider.swift",
  );
  const list = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageList.swift",
  );

  assert.match(rows, /struct NativeLiveMessageRow: View/);
  assert.match(rows, /NativeLiveHistoryForkDivider\(\)/);
  assert.match(rows, /NativeLiveHistorySnapshotRow/);
  assert.match(rows, /NativeLiveAssistantTurnRow/);
  assert.match(rows, /nativeLiveUserMessageRow/);

  const assistantBody = assistant.match(
    /var body: some View \{([\s\S]*?)\.frame\(maxWidth:/,
  )?.[1] ?? "";
  const activityIndex = assistantBody.indexOf("activityArea");
  const messageIndex = assistantBody.indexOf(
    "NativeLiveMessagePresentationView",
  );
  const actionsIndex = assistantBody.indexOf(
    "nativeLiveAssistantActions",
  );
  assert.ok(activityIndex >= 0);
  assert.ok(messageIndex > activityIndex);
  assert.ok(actionsIndex > messageIndex);
  assert.match(
    assistant,
    /timestampText:turn\.timestamp\.map \{ MessageTimestampFormatter\.string/,
  );
  assert.match(assistant, /murmurText:turn\.murmurText/);

  assert.match(user, /struct NativeLiveUserMessagePresentationView: View/);
  assert.match(history, /struct NativeLiveHistorySnapshotRow: View/);
  assert.match(divider, /struct NativeLiveHistoryForkDivider: View/);

  assert.match(blocks, /struct NativeLiveMessagePresentationView: View/);
  assert.match(blocks, /struct NativeLiveVisualNodeView: View/);
  assert.match(blocks, /NativeLiveMessageRendererRegistry\.renderer\(for: node\)/);

  assert.match(list, /LazyVStack/);
  assert.match(list, /NativeLiveMessageRow\(row:row/);
  assert.match(list, /if row\.isHistoryDivider \{/);
  assert.match(list, /\.id\(bottomAnchorID\)/);

  assert.match(root, /struct NativeLiveMessageSurface: View/);
  assert.match(root, /nativeLiveMessageList\(/);
  assert.match(root, /await onLoadOlder\(\)/);
  assert.match(root, /\.refreshable \{[\s\S]*await onRefresh\(\)/);
  assert.doesNotMatch(root, /struct NativeLiveMessageRow: View/);
  assert.doesNotMatch(root, /struct NativeLiveAssistantTurnRow: View/);
  assert.doesNotMatch(root, /struct NativeLiveUserMessagePresentationView: View/);
});

test("scroll-to-latest visibility only commits geometry changes during real user scrolling", () => {
  const root = fs.readFileSync(rootPath, "utf8");
  const state = readExisting(
    "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveConversationScrollState.swift",
  );

  assert.match(
    root,
    /@State private var scrollState = NativeLiveConversationScrollState\(\)/,
  );
  assert.match(root, /\.onScrollGeometryChange\(for:NativeLiveScrollMetrics\.self\)/);
  assert.match(root, /scrollState\.geometryChanged\(isNearBottom:metrics\.nearBottom\)/);
  assert.match(root, /\.onScrollPhaseChange/);
  assert.match(
    root,
    /phase == \.tracking \|\| phase == \.interacting \|\| phase == \.decelerating/,
  );
  assert.match(root, /scrollState\.interactionChanged\(interacting\)/);
  assert.match(root, /if scrollState\.shouldShowReturnToBottom \{/);
  assert.match(root, /scrollState\.returnToBottom\(\)/);
  assert.match(root, /accessibilityLabel\("Scroll to latest"\)/);
  assert.doesNotMatch(root, /\.onScrollVisibilityChange\(/);

  assert.match(state, /private\(set\) var isNearBottom = true/);
  assert.match(state, /private\(set\) var followLatest = true/);
  assert.match(state, /private\(set\) var userIsInteracting = false/);
  assert.match(
    state,
    /mutating func geometryChanged\(isNearBottom: Bool\)[\s\S]*if userIsInteracting \{ followLatest = isNearBottom \}/,
  );
  assert.match(
    state,
    /var shouldFollowContent: Bool \{ followLatest && !userIsInteracting \}/,
  );
  assert.match(
    state,
    /var shouldShowReturnToBottom: Bool \{ !isNearBottom \}/,
  );
});

test("assistant attachment renderer applies sticker layout to meme attachments", () => {
  const blocks = readExisting(messageBlocksPath);

  assert.match(
    blocks,
    /case \.attachment:[\s\S]*NativeLiveMediaCard\(input:input,stickerImage:input\.isMemeSticker\)/,
  );
});
