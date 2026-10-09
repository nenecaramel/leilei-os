import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const surface = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
  "utf8",
);
const paginationPresentation = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageSurfaceChrome.swift",
  "utf8",
);
const conversationCoordination = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/App/ConversationCoordination.swift",
  "utf8",
);

test("iOS chat makes truncated Native Live history explicit", () => {
  assert.match(
    surface,
    /if snapshot\?\.olderCursor != nil \{[\s\S]*NativeLivePaginationLabel\(isLoadingOlderMessages: isLoadingOlderMessages\)/,
  );
  assert.match(paginationPresentation, /struct NativeLivePaginationLabel:[\s\S]*Text\([\s\S]*"还有更早消息"/);
  assert.match(paginationPresentation, /isLoadingOlderMessages[\s\S]*\? "Loading…"[\s\S]*: "还有更早消息"/);
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


const transforms = fs.readFileSync("ios/LeileiOS/LeileiOS/App/NativeLiveCurrentPathTransforms.swift", "utf8");

test("forced current-path refresh replaces the recent suffix without dropping loaded older history", () => {
  assert.match(
    conversationCoordination,
    /let deltaAnchor =[\s\S]*requireForceRefresh[\s\S]*\? nil[\s\S]*existingSnapshot\?\.currentHeadMessageId/,
  );
  assert.match(
    transforms,
    /mergeNativeLiveRefresh\([\s\S]*preservedPrefix \+ refreshed\.messages/,
  );
  assert.match(
    conversationCoordination,
    /chatRefreshPendingForce = false[\s\S]*requireForceRefresh = true/,
  );
  assert.match(
    transforms,
    /truncated: existing\.truncated/,
  );
  assert.match(
    transforms,
    /olderCursor: existing\.olderCursor/,
  );
});
