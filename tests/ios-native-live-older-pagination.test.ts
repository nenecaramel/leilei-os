import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const surface = fs.readFileSync(
  "ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift",
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
