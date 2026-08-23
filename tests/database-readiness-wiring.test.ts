import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createAppSource = readFileSync("src/app/create-app.ts", "utf8");
const clientSource = readFileSync("src/database/client.ts", "utf8");
const migrateSource = readFileSync("src/database/migrate.ts", "utf8");

test("database-backed HTTP surfaces wait for readiness before business handlers", () => {
  assert.match(createAppSource, /createDatabaseReadinessGate/);
  assert.match(createAppSource, /databaseReadinessMiddleware/);
  assert.match(createAppSource, /\/api\/v1/);
  assert.match(createAppSource, /\/mcp/);
  assert.match(createAppSource, /\/internal\/mcp/);
});

test("runtime database pools release idle sockets for Railway serverless sleep", () => {
  assert.match(clientSource, /idle_timeout\s*:\s*\d+/);
});

test("migration readiness uses bounded connection and idle timeouts", () => {
  assert.match(migrateSource, /connect_timeout\s*:\s*\d+/);
  assert.match(migrateSource, /idle_timeout\s*:\s*\d+/);
});
