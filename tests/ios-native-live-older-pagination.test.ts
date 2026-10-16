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

test("durable background result remains a unique, read-only chat row across pagination and head-stable refresh", () => {
  const models = fs.readFileSync("ios/LeileiOS/LeileiOS/Infrastructure/API/NativeLive/NativeLiveModels.swift", "utf8");
  const assembler = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveConversationPresentationAssembler.swift", "utf8");
  const rows = fs.readFileSync("ios/LeileiOS/LeileiOS/Chat/MessageSurface/NativeLiveMessageRows.swift", "utf8");
  const snapshotTransforms = fs.readFileSync("ios/LeileiOS/LeileiOS/App/NativeLiveCurrentPathTransforms.swift", "utf8");
  assert.match(models, /struct NativeLiveBackgroundResultSnapshot: Decodable, Sendable, Equatable, Identifiable/);
  assert.match(models, /var backgroundResults: \[NativeLiveBackgroundResultSnapshot\]\? = nil/);
  assert.match(assembler, /snapshot\?\.backgroundResults \?\? \[\]/);
  assert.match(assembler, /id: "background:\\\(result\.id\)"/);
  assert.match(assembler, /row\.backgroundResult = result/);
  assert.match(assembler, /backgroundResults\[backgroundIndex\]\.createdAt <= message\.createdAt/);
  assert.match(rows, /else if let result = row\.backgroundResult/);
  assert.match(rows, /NativeLiveIMessageTextBubbleList\(/);
  assert.match(rows, /onRetry: nil,/);
  assert.match(rows, /NativeLiveMessagePresentationView\(presentation: presentation\)/);
  assert.match(snapshotTransforms, /backgroundResults: refreshed\.backgroundResults/);
  assert.match(snapshotTransforms, /backgroundResults: delta\.backgroundResults/);
  assert.match(conversationCoordination, /backgroundResults: latest\.backgroundResults/);
  assert.match(conversationCoordination, /result\.outcome == "timeout"[\s\S]*?refreshNativeLiveCurrentPath\(/);
});
