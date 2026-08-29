import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositorySource = readFileSync(
  new URL("../src/domains/bridge/bridge-event-repository.ts", import.meta.url),
  "utf8",
);

test("reserveNext returns only the id and reads the event through the Drizzle schema", () => {
  const reserveNextSource = repositorySource.slice(
    repositorySource.indexOf("async reserveNext"),
    repositorySource.indexOf("async markDispatchStarted"),
  );

  assert.doesNotMatch(reserveNextSource, /RETURNING\s+event\.\*/);
  assert.match(reserveNextSource, /RETURNING\s+event\.id/);
  assert.doesNotMatch(reserveNextSource, /event\.created_at\s+AS\s+"createdAt"/);
  assert.match(reserveNextSource, /\.select\(bridgeEventSelection\)/);
  assert.match(reserveNextSource, /eq\(bridgeEvents\.id, reserved\[0\]\.id\)/);
  assert.match(reserveNextSource, /return event \? asBridgeEvent\(event\) : null/);
});
