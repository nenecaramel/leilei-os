import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const router = readFileSync("src/mcp/server/router.ts", "utf8");
const writeRegistry = readFileSync("src/mcp/server/register-notion-writes.ts", "utf8");

test("Phase 8.6.1 production MCP does not register Notion write tools", () => {
  assert.equal(router.includes("registerProductionNotionWriteTools"), false);
  assert.equal(router.includes("./register-notion-writes.js"), false);

  // Keep the existing implementation available for the separately reviewed 8.6.2 stage;
  // the gate is at production registration, not by deleting reusable write code.
  assert.match(writeRegistry, /export function registerProductionNotionWriteTools/);
});
