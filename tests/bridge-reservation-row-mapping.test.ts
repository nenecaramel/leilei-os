import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repositorySource = readFileSync(
  new URL("../src/domains/bridge/bridge-event-repository.ts", import.meta.url),
  "utf8",
);

test("reserveNext aliases raw SQL bridge event columns to BridgeEventRecord fields", () => {
  assert.doesNotMatch(repositorySource, /RETURNING\s+event\.\*/);
  assert.match(repositorySource, /event\.user_id\s+AS\s+"userId"/);
  assert.match(repositorySource, /event\.created_at\s+AS\s+"createdAt"/);
  assert.match(repositorySource, /event\.visible_text\s+AS\s+"visibleText"/);
  assert.match(repositorySource, /event\.model_context\s+AS\s+"modelContext"/);
  assert.match(repositorySource, /event\.reserved_by\s+AS\s+"reservedBy"/);
  assert.match(repositorySource, /event\.reservation_expires_at\s+AS\s+"reservationExpiresAt"/);
  assert.match(repositorySource, /event\.last_error_code\s+AS\s+"lastErrorCode"/);
});
