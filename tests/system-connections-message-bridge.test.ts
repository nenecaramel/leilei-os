import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("System Connections bridge entry is bounded and sends only text", () => {
  const source = readFileSync("web/src/pages/SystemConnectionsPageContent.tsx", "utf8");
  assert.match(source, /maxLength=\{4000\}/);
  assert.match(source, /JSON\.stringify\(\{ text \}\)/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /\/bridge\/events/);
  assert.doesNotMatch(source, /localStorage/);
});
