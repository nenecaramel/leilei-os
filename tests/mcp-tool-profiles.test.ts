import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  mcpToolSurfaceEnabled,
  parseMcpToolProfiles,
  resolveMcpToolExposure,
} from "../src/mcp/server/tool-profiles.js";

test("public MCP defaults expose core + device + UI but hide maintenance/runtime surfaces", () => {
  const exposure = resolveMcpToolExposure(
    DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
  );
  assert.equal(mcpToolSurfaceEnabled(exposure, "core"), true);
  assert.equal(mcpToolSurfaceEnabled(exposure, "device"), true);
  assert.equal(mcpToolSurfaceEnabled(exposure, "ui"), true);
});

test("internal MCP defaults preserve the full supported maintenance surface", () => {
  const exposure = resolveMcpToolExposure(
    DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  );
  assert.equal(mcpToolSurfaceEnabled(exposure, "ui"), false);
  for (const surface of [
    "core",
    "device",
  ] as const) {
    assert.equal(mcpToolSurfaceEnabled(exposure, surface), true);
  }
});

test("the removed Notion profiles are unknown", () => {
  assert.deepEqual([...DEFAULT_INTERNAL_MCP_TOOL_PROFILES], ["core", "device"]);
  for (const profile of ["notion", "notion_advanced"]) {
    assert.throws(() => parseMcpToolProfiles(`core,${profile}`, []), /Unknown MCP tool profile/);
  }
});

test("MCP tool profile parser supports explicit composable surfaces and rejects unknown profiles", () => {
  assert.deepEqual(
    parseMcpToolProfiles(
      "core,device,ui",
      DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
    ),
    ["core", "device", "ui"],
  );
  assert.throws(
    () => parseMcpToolProfiles("core,conversation_recovery", []),
    /Unknown MCP tool profile/,
  );
  assert.throws(
    () => parseMcpToolProfiles("core,legacy_aliases", []),
    /Unknown MCP tool profile/,
  );
  assert.throws(
    () => parseMcpToolProfiles("core,unknown", []),
    /Unknown MCP tool profile/,
  );
});
