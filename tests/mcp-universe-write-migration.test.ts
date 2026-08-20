import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("Universe MCP write migration keeps UUID ledger values and admits prefixed resource ids", async () => {
  const files = await readdir(new URL("../drizzle/", import.meta.url));
  const migration = files.find((file) => /^0025_.*\.sql$/.test(file));
  const sql = migration
    ? await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8")
    : "";
  assert.match(sql, /resource_id.*TYPE text/i);
  assert.match(sql, /resource_id::text/i);
  assert.match(sql, /create_universe_node/);
  assert.match(sql, /create_universe_relation/);
  assert.match(sql, /universe_node/);
  assert.match(sql, /universe_relation/);
});
