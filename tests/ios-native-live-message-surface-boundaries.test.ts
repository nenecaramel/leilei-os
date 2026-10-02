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
