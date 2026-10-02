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

