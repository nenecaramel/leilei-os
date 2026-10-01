import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chatView = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/ChatView.swift",
  "utf8",
);

test("iOS chat does not keep production awake with foreground current-path polling", () => {
  assert.doesNotMatch(chatView, /\.task\(id: foregroundSyncTaskID\)/);
  assert.doesNotMatch(chatView, /observeForegroundConversationChanges/);
  assert.doesNotMatch(chatView, /for:\s*\.seconds\(12\)/);

  assert.match(
    chatView,
    /\.task\(id: appModel\.activeNativeLiveConversationID\)[\s\S]*refreshNativeLiveCurrentPath\(\)/,
  );
  assert.match(
    chatView,
    /\.onChange\(of: scenePhase\)[\s\S]*refreshNativeLiveCurrentPath\(\)/,
  );
  assert.match(
    chatView,
    /onRefresh:[\s\S]*refreshNativeLiveCurrentPath\(force: true\)/,
  );
});
