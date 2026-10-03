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

  assert.equal(fs.existsSync(markdownPath), true);
  const markdown = readExisting(markdownPath);

  assert.match(markdown, /struct ChatMarkdownView: View/);
  assert.match(markdown, /enum ChatMarkdownBlock/);
  assert.match(markdown, /enum ChatMarkdownParser/);

  assert.doesNotMatch(root, /struct ChatMarkdownView: View/);
  assert.doesNotMatch(root, /enum ChatMarkdownBlock/);
  assert.doesNotMatch(root, /enum ChatMarkdownParser/);
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

  assert.equal(fs.existsSync(runtimeActivityPath), true);
  assert.equal(fs.existsSync(runtimeActivityProjectionPath), true);
  assert.equal(fs.existsSync(runtimeActivityLifecyclePath), true);
  assert.equal(fs.existsSync(runtimeActivityToolsPath), true);
  assert.equal(fs.existsSync(runtimeActivityTasksPath), true);
  const runtime = readExisting(runtimeActivityPath);
  const projection = readExisting(runtimeActivityProjectionPath);
  const lifecycleProjection = readExisting(runtimeActivityLifecyclePath);
  const toolProjection = readExisting(runtimeActivityToolsPath);
  const taskProjection = readExisting(runtimeActivityTasksPath);

  for (const symbol of [
    "struct NativeLiveRuntimeAssistantRow",
    "struct NativeLiveTurnActivityView",
    "struct NativeLiveLifecycleActivityRow",
    "struct NativeLiveTaskActivityRow",
    "struct NativeLiveTaskResourceRow",
    "struct NativeLiveToolActivityRow",
    "struct AssistantTypingIndicatorRow",
    "enum NativeLiveToolCallState",
    "struct NativeLiveToolCallCard",
    "struct NativeLiveToolResultCard",
    "struct NativeLiveToolDetailSheet",
  ]) {
    assert.match(runtime, new RegExp(symbol));
    assert.doesNotMatch(root, new RegExp(symbol));
  }

  assert.match(
    projection,
    /struct NativeLiveTurnActivityProjection/,
  );
  assert.doesNotMatch(
    runtime,
    /struct NativeLiveTurnActivityProjection/,
  );
  assert.doesNotMatch(
    root,
    /struct NativeLiveTurnActivityProjection/,
  );

  assert.match(projection, /childTools/);
  assert.match(projection, /topLevelTools/);
  assert.match(projection, /permissionInteractions/);
  assert.match(projection, /topLevelInteractions/);
  assert.match(projection, /!\$0\.hiddenFromTranscript/);
  assert.match(projection, /!\$0\.hiddenFromActivity/);
  assert.match(projection, /!\$0\.isAmbient/);
  assert.match(projection, /pendingInteractionIDs/);
  assert.match(projection, /isActiveBackgroundTask/);
  assert.match(projection, /hasActiveBackgroundTask/);
  assert.match(projection, /return "Background"/);

  assert.match(lifecycleProjection, /api_retry/);
  assert.match(lifecycleProjection, /command_lifecycle/);
  assert.doesNotMatch(lifecycleProjection, /album_saved/);

  assert.match(toolProjection, /tool_use_id/);
  assert.match(toolProjection, /parent_tool_use_id/);
  assert.match(toolProjection, /parent_agent_id/);
  assert.match(toolProjection, /hidden_from_transcript/);
  assert.match(toolProjection, /hidden_from_activity/);
  assert.match(toolProjection, /resource_links/);

  assert.match(taskProjection, /task_id/);
  assert.match(taskProjection, /subagent_type/);
  assert.match(taskProjection, /is_backgrounded/);
  assert.match(taskProjection, /ambient/);
  assert.match(taskProjection, /spawn_depth/);
  assert.match(taskProjection, /hidden_from_transcript/);
  assert.match(taskProjection, /resource_links/);
  assert.match(taskProjection, /activeTaskIDs/);
  assert.match(taskProjection, /task\.phase != "active_set"/);
  assert.match(runtime, /case \.running:/);
  assert.match(runtime, /case \.completed:/);
  assert.match(runtime, /case \.failed:/);
  assert.match(runtime, /tertiarySectionTitle/);
  assert.match(runtime, /"Resources"/);
  assert.match(runtime, /task\.resourceLinks/);
  assert.match(runtime, /task\.isCurrentlyActive/);
  assert.match(runtime, /projection\.hasActiveBackgroundTask/);
  assert.match(runtime, /"mcp__leileios__get_diary": "Read Diary"/);
  assert.match(runtime, /"mcp__leileios_album__save_photo": "Save Photo"/);
  assert.match(runtime, /"mcp__leileios_local__send_file": "Send File"/);
  assert.match(runtime, /prefixes\.first/);
  assert.doesNotMatch(runtime, /return "LeileiOS · "/);
  assert.doesNotMatch(runtime, /runtimeSurface\?\.activityText/);
  assert.doesNotMatch(runtime, /runtimeSurface\?\.interactions\.first/);

  const runtimeModels = readExisting(runtimeModelsPath);
  assert.doesNotMatch(runtimeModels, /var activityText:/);
  assert.doesNotMatch(runtimeModels, /Working on a task/);
  assert.doesNotMatch(runtimeModels, /Task in progress/);
  assert.doesNotMatch(runtimeModels, /Using a tool/);

  assert.match(runtime, /Text\(projection\.summaryLabel\)/);
  assert.match(runtime, /let timestampText: String\?/);
  assert.match(
    runtime,
    /Button \{[\s\S]*\} label: \{\s*HStack\(\s*alignment: \.firstTextBaseline,\s*spacing: 12\s*\)[\s\S]*Text\(timestampText\)[\s\S]*Text\(projection\.summaryLabel\)[\s\S]*Spacer\(minLength: 8\)[\s\S]*"chevron\.right"/,
  );
  assert.doesNotMatch(
    runtime,
    /HStack\(\s*alignment: \.firstTextBaseline,\s*spacing: 12\s*\) \{[\s\S]*Text\(timestampText\)[\s\S]*Button \{/,
  );
  assert.match(
    runtime,
    /\.frame\(\s*maxWidth: \.infinity,\s*alignment: \.leading\s*\)/,
  );
  assert.match(runtime, /"chevron\.right"/);
  assert.match(runtime, /"chevron\.down"/);
  assert.doesNotMatch(runtime, /projection\.headerTitle/);
  assert.doesNotMatch(runtime, /projection\.stateLabel/);
  assert.doesNotMatch(runtime, /private var stateIcon/);

  assert.match(projection, /var summaryLabel: String/);
  assert.equal(
    projection.includes(
      'return "Working for \\(Self.durationText(elapsedSeconds))"',
    ),
    true,
  );
  assert.equal(
    projection.includes(
      'return "Worked for \\(Self.durationText(elapsedSeconds))"',
    ),
    true,
  );
  assert.match(projection, /duration_ms/);
  assert.match(
    projection,
    /tools\.count \+ tasks\.count \+ topLevelInteractions\.count/,
  );
  assert.doesNotMatch(
    projection,
    /tools\.count \+ tasks\.count \+ interactions\.count/,
  );
  assert.match(projection, /"1 step"/);
  assert.match(projection, /"\\(activityCount\) steps"/);
  assert.doesNotMatch(projection, /components\.append\("Done"\)/);
  assert.doesNotMatch(projection, /"1 activity"/);
  assert.doesNotMatch(projection, /"\\(activityCount\) activities"/);
  assert.doesNotMatch(projection, /var headerTitle: String/);

  const activityViewBlock = runtime.match(
    /struct NativeLiveTurnActivityView: View \{([\s\S]*?)private struct NativeLiveLifecycleActivityRow: View \{/,
  )?.[1] ?? "";
  assert.doesNotMatch(activityViewBlock, /RoundedRectangle/);
  assert.doesNotMatch(activityViewBlock, /\.background\(/);
});

const attachmentPresentationPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveAttachmentPresentation.swift";

test("current attachment presentation is extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(attachmentPresentationPath), true);
  const attachment = readExisting(attachmentPresentationPath);

  assert.match(attachment, /struct NativeLiveAttachmentBlockView/);
  assert.match(attachment, /struct NativeLiveAttachmentPreview/);
  assert.match(attachment, /struct NativeLiveAttachmentQuickLook/);
  assert.match(attachment, /func nativeLiveSafePreviewFilename/);

  assert.match(attachment, /data\.count != expectedSize/);
  assert.match(attachment, /SHA256\.hash\(data: data\)/);
  assert.match(attachment, /actual == expectedSHA256/);
  assert.match(attachment, /removeItem\(\s*at: previewDirectoryURL\s*\)/);

  assert.doesNotMatch(root, /struct NativeLiveAttachmentBlockView/);
  assert.doesNotMatch(root, /struct NativeLiveAttachmentQuickLook/);
});

const messageRowsPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageRows.swift";
const messageBlocksPath =
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageBlocks.swift";

test("canonical voice input is a tappable compact bubble that expands and collapses its transcript", () => {
  const rows = readExisting(messageRowsPath);

  assert.match(
    rows,
    /block\.payload\?\["input_mode"\]\?\.stringValue\s*== "voice"/,
  );
  assert.match(
    rows,
    /guard displayTextOverride == nil else \{\s*return false\s*\}/,
  );
  assert.match(rows, /struct NativeLiveVoiceMessageBubbleVisual: View/);
  assert.match(rows, /Image\(systemName: "waveform"\)/);
  assert.match(rows, /\.frame\(width: 68, alignment: \.leading\)/);
  assert.match(rows, /\.frame\(height: 21, alignment: \.leading\)/);
  assert.doesNotMatch(rows, /speaker\.wave/);
  assert.doesNotMatch(rows, /Button\("转文字"\)/);
  assert.match(rows, /@State private var isVoiceTranscriptRevealed = false/);
  assert.match(rows, /onTap: \{[\s\S]*isVoiceTranscriptRevealed\.toggle\(\)/);
  assert.doesNotMatch(rows, /\.onTapGesture \{/);
  assert.match(
    rows,
    /if isVoiceInputMessage \{[\s\S]*NativeLiveVoiceMessageBubbleVisual\([\s\S]*if isVoiceTranscriptRevealed,[\s\S]*ChatMarkdownView\(/,
  );
  assert.match(
    rows,
    /systemName:[\s\S]*isExpanded[\s\S]*"chevron\.up"[\s\S]*"chevron\.down"/,
  );
  assert.match(
    rows,
    /LightweightContextMenuInteraction\([\s\S]*copyText: copyText[\s\S]*onEditMessage\(message\)/,
  );
  assert.doesNotMatch(rows, /voice.*duration|duration.*voice|seconds|秒/i);
});

test("message rows and canonical block rendering are extracted while root composition stays put", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(messageRowsPath), true);
  assert.equal(fs.existsSync(messageBlocksPath), true);

  const rows = readExisting(messageRowsPath);
  const blocks = readExisting(messageBlocksPath);

  const assistantContentBlock = rows.match(
    /private var assistantContent: some View \{([\s\S]*?)@ViewBuilder\s+private var messageContent:/,
  )?.[1] ?? "";
  const timestampIndex = assistantContentBlock.indexOf(
    "MessageTimestampFormatter.string",
  );
  const activityIndex = assistantContentBlock.indexOf(
    "NativeLiveTurnActivityView",
  );
  const messageContentIndex = assistantContentBlock.indexOf(
    "messageContent",
  );
  assert.ok(timestampIndex >= 0);
  assert.ok(activityIndex > timestampIndex);
  assert.ok(messageContentIndex > activityIndex);
  assert.match(rows, /timestampText: timestamp/);
  assert.match(
    rows,
    /if displayedActivityProjection\.hasContent \{[\s\S]*NativeLiveTurnActivityView[\s\S]*\} else \{[\s\S]*Text\(timestamp\)/,
  );

  assert.match(rows, /nativeLiveBackgroundRuntimeSurfaces/);
  assert.match(rows, /message\.activity\?\.prepareId/);
  assert.match(rows, /backgroundSurface/);
  assert.match(
    rows,
    /onResolveInteraction:[\s\S]*onResolveReplacementInteraction/,
  );

  for (const symbol of [
    "struct NativeLiveMessageRow",
    "struct NativeLiveHistorySnapshotRow",
    "struct NativeLiveHistoryForkDivider",
    "struct NativeLiveOptimisticUserRow",
  ]) {
    assert.match(rows, new RegExp(symbol));
    assert.doesNotMatch(root, new RegExp(symbol));
  }

  assert.match(blocks, /struct NativeLiveBlockView/);
  assert.doesNotMatch(root, /struct NativeLiveBlockView/);

  assert.match(root, /struct NativeLivePendingOperation/);
  assert.match(root, /struct NativeLiveMessageSurface: View/);
  assert.match(root, /"还有更早消息"/);
  assert.match(root, /await onLoadOlder\(\)/);
  assert.match(root, /NativeLiveRuntimeAssistantRow/);
  assert.match(root, /activityRuntimeSurface:/);
  assert.match(root, /matchingRuntimeSurface\(for: snapshot\)/);
  assert.match(
    root,
    /UUID\(uuidString: snapshot\.conversationId\)[\s\S]*== runtimeSurface\.conversationID/,
  );
  assert.match(
    root,
    /canonicalAssistantAfterLatestUserID\([\s\S]*latestUserIndex[\s\S]*tail\.last/,
  );
  assert.match(
    root,
    /activityRuntimeSurface:[\s\S]*message\.id == canonicalRuntimeAssistantID/,
  );
  assert.match(
    root,
    /pendingOperation == nil,[\s\S]*let runtimeSurface,[\s\S]*canonicalRuntimeAssistantID == nil/,
  );
  assert.doesNotMatch(
    root,
    /!runtimeSurface\.foregroundTurnCompleted[\s\S]*\|\| !hasCanonicalAssistantHead/,
  );
  assert.match(root, /\.refreshable \{[\s\S]*await onRefresh\(\)/);
});

test("scroll-to-latest visibility follows the real bottom anchor instead of transient geometry", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.match(
    root,
    /\.id\(bottomAnchorID\)[\s\S]*\.onScrollVisibilityChange\(\s*threshold: 0\.01/,
  );
  assert.match(
    root,
    /let awayFromBottom = !isVisible[\s\S]*isAwayFromBottom =\s*awayFromBottom/,
  );
  assert.doesNotMatch(root, /\.onScrollGeometryChange\(/);
  assert.match(
    root,
    /if isAwayFromBottom \{[\s\S]*accessibilityLabel\("Scroll to latest"\)/,
  );
});
