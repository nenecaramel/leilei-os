import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("MCP router passes its namespace into the session factory", () => {
  const source = readFileSync("src/mcp/server/router.ts", "utf8");
  assert.match(source, /createSessionServer\(userId, namespace\)/);
});

test("production factory accepts a namespace-aware context", () => {
  const source = readFileSync("src/mcp/server/production-server-factory.ts", "utf8");
  assert.match(source, /McpSessionNamespace/);
});
