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

test("runtime activity and tool presentation are extracted from the message surface", () => {
  const root = fs.readFileSync(rootPath, "utf8");

  assert.equal(fs.existsSync(runtimeActivityPath), true);
  const runtime = readExisting(runtimeActivityPath);

  for (const symbol of [
    "struct NativeLiveRuntimeAssistantRow",
    "struct NativeLiveTurnActivityProjection",
    "struct NativeLiveTurnActivityView",
    "struct NativeLiveTaskActivityRow",
    "struct AssistantTypingIndicatorRow",
    "struct NativeLiveRuntimeToolCallRow",
    "enum NativeLiveToolCallState",
    "struct NativeLiveToolCallCard",
    "struct NativeLiveToolResultCard",
    "struct NativeLiveToolDetailSheet",
  ]) {
    assert.match(runtime, new RegExp(symbol));
    assert.doesNotMatch(root, new RegExp(symbol));
  }

  assert.match(runtime, /task_id/);
  assert.match(runtime, /tool_use_id/);
  assert.match(runtime, /subagent_type/);
  assert.match(runtime, /is_backgrounded/);
  assert.match(runtime, /spawn_depth/);
  assert.match(runtime, /pendingInteractionIDs/);
  assert.match(runtime, /case \.running:/);
  assert.match(runtime, /case \.completed:/);
  assert.match(runtime, /case \.failed:/);
  assert.doesNotMatch(runtime, /runtimeSurface\?\.activityText/);
  assert.doesNotMatch(runtime, /runtimeSurface\?\.interactions\.first/);
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
  assert.match(root, /\.refreshable \{[\s\S]*await onRefresh\(\)/);
});
