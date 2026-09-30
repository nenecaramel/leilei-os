import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  assertPermissionCallbackQueryOptions,
  createAgentSdkPermissionCallback,
  isTrustedLeileiosTool,
  normalizeAgentSdkPermissionRequest,
  normalizeLeileiPermissionDecision,
  projectLeileiPermissionDecisionToSdk,
} from "../src/agent-sdk-permission.mjs";

test("permission request normalizes stable LeileiOS fields", () => {
  const input = { command: "pwd" };
  const request = normalizeAgentSdkPermissionRequest(
    "Bash",
    input,
    {
      toolUseId: "toolu_123",
      requestId: "req_123",
      agentId: "agent_123",
      blockedPath: "/tmp/outside",
      decisionReason: "permission_rule",
      title: "Claude wants to run Bash",
      displayName: "Run command",
      description: "pwd",
      permissionSuggestions: [
        { type: "addRules" },
      ],
      matchedAskRule: {
        source: "projectSettings",
      },
    },
  );

  assert.deepEqual(request, {
    toolName: "Bash",
    input,
    toolUseId: "toolu_123",
    requestId: "req_123",
    agentId: "agent_123",
    blockedPath: "/tmp/outside",
    decisionReason: "permission_rule",
    title: "Claude wants to run Bash",
    displayName: "Run command",
    description: "pwd",
    permissionSuggestions: [
      { type: "addRules" },
    ],
    matchedAskRule: {
      source: "projectSettings",
    },
  });
});

test("permission request accepts real Agent SDK context key casing", () => {
  const request = normalizeAgentSdkPermissionRequest(
    "Write",
    {
      file_path: "/tmp/example.txt",
      content: "hello",
    },
    {
      toolUseID: "toolu_real",
      requestId: "req_real",
      agentID: "agent_real",
    },
  );

  assert.equal(
    request.toolUseId,
    "toolu_real",
  );
  assert.equal(
    request.requestId,
    "req_real",
  );
  assert.equal(
    request.agentId,
    "agent_real",
  );
});

test("permission decisions map to SDK allow and deny without persistence semantics", () => {
  assert.deepEqual(
    projectLeileiPermissionDecisionToSdk({
      decision: "allow",
    }),
    { behavior: "allow" },
  );

  assert.deepEqual(
    projectLeileiPermissionDecisionToSdk({
      decision: "allow",
      updatedInput: {
        command: "printf rewritten",
      },
    }),
    {
      behavior: "allow",
      updatedInput: {
        command: "printf rewritten",
      },
    },
  );

  assert.deepEqual(
    projectLeileiPermissionDecisionToSdk({
      decision: "deny",
      message: "Denied by LeileiOS.",
    }),
    {
      behavior: "deny",
      message: "Denied by LeileiOS.",
      interrupt: false,
    },
  );

  assert.deepEqual(
    normalizeLeileiPermissionDecision({
      decision: "deny",
      message: "Stop the turn.",
      interrupt: true,
    }),
    {
      decision: "deny",
      message: "Stop the turn.",
      interrupt: true,
    },
  );
});

test("permission callback exposes cancellation separately and emits request/decision events", async () => {
  const events = new EventEmitter();
  const observed = [];
  events.on("permission-request", (request) => {
    observed.push({
      type: "request",
      request,
    });
  });
  events.on(
    "permission-decision",
    (payload) => {
      observed.push({
        type: "decision",
        payload,
      });
    },
  );

  const controller = new AbortController();
  let signalSeen = null;
  const callback =
    createAgentSdkPermissionCallback({
      events,
      permissionHandler: async (
        request,
        { signal },
      ) => {
        signalSeen = signal;
        return {
          decision: "allow",
          updatedInput: {
            ...request.input,
            command: "printf rewritten",
          },
        };
      },
    });

  const sdkResult = await callback(
    "Bash",
    { command: "printf original" },
    {
      signal: controller.signal,
      toolUseId: "toolu_callback",
      requestId: "req_callback",
    },
  );

  assert.equal(
    signalSeen,
    controller.signal,
  );
  assert.deepEqual(sdkResult, {
    behavior: "allow",
    updatedInput: {
      command: "printf rewritten",
    },
  });
  assert.equal(observed.length, 2);
  assert.equal(
    observed[0].request.toolUseId,
    "toolu_callback",
  );
  assert.deepEqual(
    observed[1].payload.decision,
    {
      decision: "allow",
      updatedInput: {
        command: "printf rewritten",
      },
    },
  );
});

test("permission callback emits permission-error and rethrows handler failures", async () => {
  const events = new EventEmitter();
  let emitted = null;
  events.on("permission-error", (payload) => {
    emitted = payload;
  });

  const cause = new Error("ui unavailable");
  const callback =
    createAgentSdkPermissionCallback({
      events,
      permissionHandler: async () => {
        throw cause;
      },
    });

  await assert.rejects(
    callback(
      "Bash",
      { command: "pwd" },
      { toolUseId: "toolu_error" },
    ),
    (error) => error === cause,
  );

  assert.equal(emitted.cause, cause);
  assert.equal(
    emitted.request.toolUseId,
    "toolu_error",
  );
});

test("permission contract rejects ambiguous or shadowed policy combinations", () => {
  assert.throws(
    () =>
      assertPermissionCallbackQueryOptions({
        canUseTool: async () => ({
          behavior: "allow",
        }),
      }),
    /cannot be combined with queryOptions\.canUseTool/,
  );

  assert.throws(
    () =>
      assertPermissionCallbackQueryOptions({
        allowedTools: ["Bash"],
      }),
    /allowedTools/,
  );

  assert.throws(
    () =>
      assertPermissionCallbackQueryOptions({
        permissionMode:
          "bypassPermissions",
      }),
    /permission bypass/,
  );

  assert.throws(
    () =>
      assertPermissionCallbackQueryOptions({
        allowDangerouslySkipPermissions:
          true,
      }),
    /permission bypass/,
  );
});

test("permission contract rejects invalid decisions", () => {
  assert.throws(
    () =>
      normalizeLeileiPermissionDecision(
        null,
      ),
    /decision object/,
  );

  assert.throws(
    () =>
      normalizeLeileiPermissionDecision({
        decision: "allow",
        updatedInput: "not-an-object",
      }),
    /updatedInput/,
  );

  assert.throws(
    () =>
      normalizeLeileiPermissionDecision({
        decision: "deny",
        message: " ",
      }),
    /nonblank message/,
  );

  assert.throws(
    () =>
      normalizeLeileiPermissionDecision({
        decision: "later",
      }),
    /allow or deny/,
  );
});


test("all LeileiOS MCP tools bypass interactive permission", async () => {
  let permissionCalls = 0;
  const callback = createAgentSdkPermissionCallback({
    permissionHandler: async () => {
      permissionCalls += 1;
      throw new Error("must not ask");
    },
  });

  for (const toolName of [
    "mcp__leileios__get_current_time",
    "mcp__leileios__read_todo_day",
    "mcp__leileios__append_todo_entry",
    "mcp__leileios__replace_todo_paper",
    "mcp__leileios__create_universe_node",
    "mcp__leileios__update_universe_node",
  ]) {
    assert.equal(isTrustedLeileiosTool(toolName), true);
    assert.deepEqual(
      await callback(toolName, {}, {}),
      { behavior: "allow" },
    );
  }

  assert.equal(permissionCalls, 0);
});

test("non-LeileiOS tools remain on the interactive permission path", async () => {
  let permissionCalls = 0;
  const callback = createAgentSdkPermissionCallback({
    permissionHandler: async () => {
      permissionCalls += 1;
      return { decision: "allow" };
    },
  });

  assert.equal(isTrustedLeileiosTool("Bash"), false);
  assert.deepEqual(
    await callback(
      "Bash",
      { command: "pwd" },
      {},
    ),
    { behavior: "allow" },
  );
  assert.equal(permissionCalls, 1);
});
