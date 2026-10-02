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
  assert.doesNotMatch(runtime, /runtimeSurface\?\.activityText/);
  assert.doesNotMatch(runtime, /runtimeSurface\?\.interactions\.first/);

  const runtimeModels = readExisting(runtimeModelsPath);
  assert.doesNotMatch(runtimeModels, /var activityText:/);
  assert.doesNotMatch(runtimeModels, /Working on a task/);
  assert.doesNotMatch(runtimeModels, /Task in progress/);
  assert.doesNotMatch(runtimeModels, /Using a tool/);
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

test("message rows and canonical block rendering are extracted while root composition stays put", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(messageRowsPath), true);
  assert.equal(fs.existsSync(messageBlocksPath), true);

  const rows = readExisting(messageRowsPath);
  const blocks = readExisting(messageBlocksPath);

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
  assert.match(root, /runtimeSurface\?[\s\S]*foregroundTurnCompleted == true/);
  assert.match(root, /!runtimeSurface\.foregroundTurnCompleted[\s\S]*\|\| !hasCanonicalAssistantHead/);
  assert.match(root, /\.refreshable \{[\s\S]*await onRefresh\(\)/);
});
