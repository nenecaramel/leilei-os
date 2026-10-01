import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeClaudeEvents,
} from "../tools/claude-bridge/src/normalized-events.mjs";
import {
  canonicalizeNativeLiveEvents,
} from "../src/domains/conversation/native-live-conversation-orchestrator.js";

const base = {
  logicalConversationId: "conversation-1",
  mode: "new",
  parentProviderSessionId: null,
};

test("tool_use_meta is preserved for Runtime UI but stripped from canonical tool content", () => {
  const events = normalizeClaudeEvents(
    [{
      type: "assistant",
      session_id: "session-1",
      tool_use_meta: {
        "toolu-1": {
          display_name: "Search LeileiOS",
          server_display_name: "LeileiOS",
          icon_url: "https://example.test/leileios.png",
        },
      },
      message: {
        content: [{
          type: "tool_use",
          id: "toolu-1",
          name: "mcp__leileios__global_search",
          input: { query: "Mind" },
        }],
      },
    }],
    base,
  );

  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.payload, {
    tool_use_id: "toolu-1",
    tool_name: "mcp__leileios__global_search",
    input: { query: "Mind" },
    display_name: "Search LeileiOS",
    server_display_name: "LeileiOS",
    icon_url: "https://example.test/leileios.png",
  });

  const canonical = canonicalizeNativeLiveEvents(events);
  assert.deepEqual(canonical.blocks, [{
    kind: "tool_use",
    rawType: "tool_use",
    payload: {
      tool_use_id: "toolu-1",
      tool_name: "mcp__leileios__global_search",
      input: { query: "Mind" },
    },
  }]);
});

test("tool_use_meta accepts the observed array sidecar shape", () => {
  const events = normalizeClaudeEvents(
    [{
      type: "assistant",
      session_id: "session-1",
      tool_use_meta: [{
        id: "toolu-2",
        display_name: "Read file",
        server_display_name: "Filesystem",
      }],
      message: {
        content: [{
          type: "tool_use",
          id: "toolu-2",
          name: "Read",
          input: { file_path: "fixture.txt" },
        }],
      },
    }],
    base,
  );

  assert.equal(events[0]?.payload?.display_name, "Read file");
  assert.equal(events[0]?.payload?.server_display_name, "Filesystem");
});

test("api_retry keeps bounded retry telemetry for both SDK wire shapes", () => {
  const events = normalizeClaudeEvents(
    [
      {
        type: "system",
        subtype: "api_retry",
        session_id: "session-1",
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 1_250.5,
        error_status: 529,
        error: "overloaded",
      },
      {
        type: "api_retry",
        session_id: "session-1",
        attempt: 3,
        max_retries: 10,
        retry_delay_ms: 2_500,
        error_status: null,
        error: "no_response",
        no_response: true,
      },
    ],
    base,
  );

  assert.deepEqual(events.map((event) => event.payload), [
    {
      kind: "api_retry",
      attempt: 2,
      max_retries: 10,
      retry_delay_ms: 1_250.5,
      error_status: 529,
      error: "overloaded",
      no_response: null,
    },
    {
      kind: "api_retry",
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 2_500,
      error_status: null,
      error: "no_response",
      no_response: true,
    },
  ]);
});

test("system informational preserves only bounded warning and notice fields", () => {
  const [event] = normalizeClaudeEvents(
    [{
      type: "system",
      subtype: "informational",
      session_id: "session-1",
      level: "warning",
      content: "MCP server is reconnecting.",
      title: "MCP warning",
      code: "mcp_reconnect",
      source: "mcp",
      local_path: "/Users/private/secret",
      internal_debug: { token: "do-not-persist" },
    }],
    base,
  );

  assert.deepEqual(event?.payload, {
    kind: "provider_notice",
    level: "warning",
    content: "MCP server is reconnecting.",
    title: "MCP warning",
    code: "mcp_reconnect",
    source: "mcp",
  });
});

test("iOS Runtime UI prefers SDK tool display names and surfaces API retry state", () => {
  const models = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Infrastructure/NativeLiveRuntimeModels.swift", import.meta.url),
    "utf8",
  );
  const surface = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Chat/NativeLiveMessageSurface.swift", import.meta.url),
    "utf8",
  );

  assert.match(models, /payload\["display_name"\]/);
  assert.match(models, /payload\["kind"\]\?\.stringValue == "api_retry"/);
  assert.match(surface, /payload\?\["display_name"\]/);
});


test("system/init preserves bounded authoritative environment and never becomes canonical content", () => {
  const [event] = normalizeClaudeEvents(
    [{
      type: "system",
      subtype: "init",
      session_id: "session-init",
      model: "claude-sonnet-5-5",
      cwd: "/Users/Admin1/Developer/leilei-os-main",
      tools: ["Read", "Bash", "mcp__leileios__global_search"],
      mcp_servers: [
        {
          name: "leileios",
          status: "connected",
          url: "https://private.invalid/mcp",
          headers: { Authorization: "Bearer should-not-persist" },
        },
      ],
      permissionMode: "default",
      slash_commands: ["/compact", "/schedule"],
      terminal_slash_commands: ["/context"],
      apiKeySource: "subscription",
      output_style: "default",
      agents: ["Explore"],
      betas: ["context-1m"],
      claude_code_version: "2.1.267",
      sdk_version: "0.3.283",
      skills: ["pdfs", "slides"],
      plugins: [{
        name: "superpowers",
        path: "/Users/Admin1/.claude/plugins/superpowers",
      }],
      plugin_errors: [{
        name: "broken-plugin",
        path: "/Users/Admin1/.claude/plugins/broken",
        error: "failed to load",
      }],
      fast_mode_state: {
        enabled: true,
        state: "on",
      },
      arbitrary_secret: "must-not-persist",
    }],
    base,
  );

  assert.equal(event?.type, "session");
  assert.deepEqual(event?.payload?.environment, {
    model: "claude-sonnet-5-5",
    cwd: "/Users/Admin1/Developer/leilei-os-main",
    tools: ["Read", "Bash", "mcp__leileios__global_search"],
    mcp_servers: [{
      name: "leileios",
      status: "connected",
    }],
    permission_mode: "default",
    slash_commands: ["/compact", "/schedule"],
    terminal_slash_commands: ["/context"],
    api_key_source: "subscription",
    output_style: "default",
    agents: ["Explore"],
    betas: ["context-1m"],
    claude_code_version: "2.1.267",
    sdk_version: "0.3.283",
    skills: ["pdfs", "slides"],
    plugins: [{
      name: "superpowers",
      path: "/Users/Admin1/.claude/plugins/superpowers",
    }],
    plugin_errors: [{
      name: "broken-plugin",
      path: "/Users/Admin1/.claude/plugins/broken",
      message: "failed to load",
    }],
    fast_mode: {
      enabled: true,
      state: "on",
    },
  });

  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /should-not-persist|private\.invalid|arbitrary_secret/);

  assert.deepEqual(
    canonicalizeNativeLiveEvents([event!]).blocks,
    [],
  );
});

test("iOS Context reads durable system/init environment from runtime metadata", () => {
  const api = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Infrastructure/LeileiAPIClient.swift", import.meta.url),
    "utf8",
  );
  const context = readFileSync(
    new URL("../ios/LeileiOS/LeileiOS/Pages/ProjectsView.swift", import.meta.url),
    "utf8",
  );

  assert.match(api, /let environment: NativeLiveRuntimeEnvironment\?/);
  assert.match(context, /Section\("Session Environment"\)/);
  assert.match(context, /metadata\?\.environment/);
  assert.match(context, /mcpServers/);
});
