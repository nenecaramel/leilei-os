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
  assert.equal(mcpToolSurfaceEnabled(exposure, "notion"), false);
  assert.equal(mcpToolSurfaceEnabled(exposure, "notion_advanced"), false);
  assert.equal(
    mcpToolSurfaceEnabled(exposure, "conversation_recovery"),
    false,
  );
  assert.equal(
    mcpToolSurfaceEnabled(exposure, "runtime_internal"),
    false,
  );
  assert.equal(mcpToolSurfaceEnabled(exposure, "ui"), true);
});

test("internal MCP defaults preserve full surface for dedicated maintenance/runtime hosts", () => {
  const exposure = resolveMcpToolExposure(
    DEFAULT_INTERNAL_MCP_TOOL_PROFILES,
  );
  for (const surface of [
    "core",
    "notion",
    "notion_advanced",
    "conversation_recovery",
    "device",
    "ui",
    "runtime_internal",
  ] as const) {
    assert.equal(mcpToolSurfaceEnabled(exposure, surface), true);
  }
});

test("notion_advanced profile includes the typed Notion surface plus advanced tools", () => {
  const exposure = resolveMcpToolExposure(["notion_advanced"]);
  assert.equal(mcpToolSurfaceEnabled(exposure, "notion"), true);
  assert.equal(mcpToolSurfaceEnabled(exposure, "notion_advanced"), true);
  assert.equal(mcpToolSurfaceEnabled(exposure, "runtime_internal"), false);
});

test("MCP tool profile parser supports explicit composable surfaces and rejects unknown profiles", () => {
  assert.deepEqual(
    parseMcpToolProfiles(
      "core,notion,notion_advanced,conversation_recovery",
      DEFAULT_PUBLIC_MCP_TOOL_PROFILES,
    ),
    ["core", "notion", "notion_advanced", "conversation_recovery"],
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
