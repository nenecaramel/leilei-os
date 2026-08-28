import assert from "node:assert/strict";
import test from "node:test";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

test("MCP Apps server exports required by the bridge are available", () => {
  assert.equal(typeof registerAppResource, "function");
  assert.equal(typeof RESOURCE_MIME_TYPE, "string");
  assert.ok(RESOURCE_MIME_TYPE.length > 0);
});
