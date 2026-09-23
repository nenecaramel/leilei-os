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
const typedWriteRegistry = readFileSync(
  "src/mcp/server/register-notion-typed-writes.ts",
  "utf8",
);

test("production Notion profile uses typed facade while legacy explicit writes stay advanced-only", () => {
  assert.doesNotMatch(router, /registerProductionNotionExplicitWriteTools/);
  assert.doesNotMatch(router, /registerProductionNotionTypedWriteTools/);
  assert.match(productionFactory, /registerProductionNotionTypedWriteTools/);
  assert.match(productionFactory, /registerProductionNotionExplicitWriteTools/);
  assert.match(productionFactory, /mcpToolSurfaceEnabled\(toolExposure, "notion"\)/);
  assert.match(productionFactory, /mcpToolSurfaceEnabled\(toolExposure, "notion_advanced"\)/);

  for (const name of [
    "create_notion_page",
    "update_notion_page_properties",
    "append_notion_page_content",
    "replace_notion_page_content",
    "add_notion_comment",
    "reply_notion_comment",
  ]) {
    assert.match(typedWriteRegistry, new RegExp(name));
  }

  assert.match(explicitWriteRegistry, /write_notion_page/);
  assert.match(explicitWriteRegistry, /write_notion_comment/);
  assert.equal(explicitWriteRegistry.includes("write_notion_block"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_database"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_data_source"), false);
  assert.equal(explicitWriteRegistry.includes("write_notion_view"), false);
  assert.equal(explicitWriteRegistry.includes("upload_notion_file"), false);
});
