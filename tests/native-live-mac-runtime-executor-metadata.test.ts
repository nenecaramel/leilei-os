import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacRuntimeExecutor,
} from "../src/domains/bridge/mac/native-live-mac-runtime-executor.js";
import {
  command,
} from "./helpers/native-live-mac-runtime-executor-fixtures.js";

test("VCS mutation hints are persisted as durable runtime metadata", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-vcs",
        normalizedEvents: [
          {
            type: "runtime",
            payload: {
              kind: "vcs_state_changed",
              mutation_kind: "commit",
              cwd: "/workspace/repo",
              branch: "main",
            },
          },
          {
            type: "runtime",
            payload: {
              kind: "vcs_state_changed",
              mutation_kind: "push",
              cwd: "/workspace/repo/subdir",
              branch: null,
            },
          },
        ],
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace/repo",
  ).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.normalized_events, []);
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    vcs_changes: [
      {
        mutation_kind: "commit",
        cwd: "/workspace/repo",
        branch: "main",
      },
      {
        mutation_kind: "push",
        cwd: "/workspace/repo/subdir",
        branch: null,
      },
    ],
  });
});

test("provider terminal failure retains VCS mutation hints", async () => {
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      throw Object.assign(
        new Error("provider failed after commit"),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          normalizedEvents: [{
            type: "runtime",
            payload: {
              kind: "vcs_state_changed",
              mutation_kind: "commit",
              cwd: "/workspace/repo",
              branch: "feature/test",
            },
          }],
        },
      );
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace/repo",
  ).execute(command());

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    vcs_changes: [{
      mutation_kind: "commit",
      cwd: "/workspace/repo",
      branch: "feature/test",
    }],
  });
});

test("SessionStore health is persisted as durable runtime metadata", async () => {
  const sessionStore = {
    provider: "claude_agent_sdk" as const,
    configured: true,
    mode: "new" as const,
    session_id: "provider-session-store",
    parent_session_id: null,
    project_key: "/workspace",
    cwd: "/workspace",
    parent_local_available: null,
    parent_status_before: null,
    backfill_status: "not_needed" as const,
    backfill_failure_reason: null,
    mirror_status: "ok" as const,
    mirror_failure_reason: null,
    status_after: "complete" as const,
    status_failure_reason: null,
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-session-store",
        normalizedEvents: [],
        sessionStoreObservability: sessionStore,
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    session_store: sessionStore,
  });
});

test("provider terminal failure retains SessionStore mirror health", async () => {
  const sessionStore = {
    provider: "claude_agent_sdk" as const,
    configured: true,
    mode: "new" as const,
    session_id: "provider-failed-store",
    parent_session_id: null,
    project_key: "/workspace",
    cwd: "/workspace",
    parent_local_available: null,
    parent_status_before: null,
    backfill_status: "not_needed" as const,
    backfill_failure_reason: null,
    mirror_status: "error" as const,
    mirror_failure_reason: "remote append failed",
    status_after: "incomplete" as const,
    status_failure_reason: null,
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      throw Object.assign(
        new Error("provider failed"),
        {
          runtimeCode: "CLAUDE_PROCESS_FAILED",
          normalizedEvents: [],
          sessionStoreObservability: sessionStore,
        },
      );
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "failure");
  if (result.status !== "failure") throw new Error("expected failure");
  assert.equal(result.error_code, "CLAUDE_PROCESS_FAILED");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    session_store: sessionStore,
  });
});

test("system/init environment is persisted with terminal runtime metadata", async () => {
  const environment = {
    model: "claude-sonnet-5-5",
    cwd: "/workspace",
    tools: ["Read", "Bash"],
    mcp_servers: [{ name: "leileios", status: "connected", source: null }],
    permission_mode: "default",
    slash_commands: ["/compact"],
    terminal_slash_commands: [],
    api_key_source: "subscription",
    output_style: "default",
    agents: ["Explore"],
    betas: [],
    claude_code_version: "2.1.267",
    sdk_version: "0.3.283",
    skills: ["pdfs"],
    plugins: [],
    plugin_errors: [],
    effort: "high",
    capabilities: ["interrupt_receipt_v1"],
    fast_mode: { state: "off", disabled_reason: null },
  };
  const runtime = {
    async sendNew() { throw new Error("unused"); },
    async resume() { throw new Error("unused"); },
    async fork() { throw new Error("unused"); },
    async executeTurn() {
      return {
        providerSessionId: "provider-init",
        normalizedEvents: [{
          type: "session",
          payload: {
            provider_session_id: "provider-init",
            parent_provider_session_id: null,
            mode: "new",
            environment,
          },
        }],
        contextUsage: null,
        executionReadback: null,
        executionReadbackError: null,
      };
    },
  };

  const result = await new NativeLiveMacRuntimeExecutor(
    runtime,
    "/workspace",
  ).execute(command());

  assert.equal(result.status, "success");
  if (result.status !== "success") throw new Error("expected success");
  assert.deepEqual(result.runtime_metadata, {
    context_usage: null,
    environment,
  });
});
