import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const router = readFileSync("src/mcp/server/router.ts", "utf8");
const productionFactory = readFileSync(
  "src/mcp/server/production-server-factory.ts",
  "utf8",
);
const explicitWriteRegistry = readFileSync(
  "src/mcp/server/register-notion-explicit-writes.ts",
  "utf8",
);

test("Phase 8.6.2 production MCP registers only the explicit Notion write gate", () => {
  assert.doesNotMatch(router, /registerProductionNotionExplicitWriteTools/);
  assert.match(productionFactory, /registerProductionNotionExplicitWriteTools/);
  assert.match(productionFactory, /\.\/register-notion-explicit-writes\.js/);
  assert.equal(router.includes("registerProductionNotionWriteTools"), false);
  assert.equal(router.includes("./register-notion-writes.js"), false);

  assert.match(explicitWriteRegistry, /write_notion_page/);
  assert.match(explicitWriteRegistry, /write_notion_comment/);
  assert.equal(explicitWriteRegistry.includes("write_notion_block"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_database"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_data_source"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_view"), false);
  assert.equal(explicitWriteRegistry.includes("upload_notion_file"), false);
});
