import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const surface = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
  "utf8",
);
const conversationCoordination = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/App/ConversationCoordination.swift",
  "utf8",
);

test("iOS chat makes truncated Native Live history explicit", () => {
  assert.match(
    surface,
    /if snapshot\?\.olderCursor != nil \{[\s\S]*Text\([\s\S]*"还有更早消息"/,
  );
  assert.match(
    surface,
    /await onLoadOlder\(\)/,
  );
  assert.match(
    surface,
    /isLoadingOlderMessages/,
  );
});

test("pull to refresh does not silently mean load older history", () => {
  assert.match(
    surface,
    /\.refreshable \{[\s\S]*await onRefresh\(\)[\s\S]*\}/,
  );
  assert.doesNotMatch(
    surface,
    /\.refreshable \{[\s\S]{0,240}await onLoadOlder\(\)/,
  );
});


test("forced current-path refresh replaces the recent suffix without dropping loaded older history", () => {
  assert.match(
    conversationCoordination,
    /let deltaAnchor =[\s\S]*force[\s\S]*\? nil[\s\S]*existingSnapshot\?\.currentHeadMessageId/,
  );
  assert.match(
    conversationCoordination,
    /mergeNativeLiveRefresh\([\s\S]*preservedPrefix \+ refreshed\.messages/,
  );
  assert.match(
    conversationCoordination,
    /truncated: existing\.truncated/,
  );
  assert.match(
    conversationCoordination,
    /olderCursor: existing\.olderCursor/,
  );
});
