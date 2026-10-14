import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  assertPermissionCallbackQueryOptions,
  createAgentSdkPermissionCallback,
  isTrustedLeileiosTool,
  trustedNativeLiveToolPolicy,
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


test("trusted LeileiOS and local Native Live tools bypass interactive permission", async () => {
  let permissionCalls = 0;
  const callback = createAgentSdkPermissionCallback({
    permissionHandler: async () => {
      permissionCalls += 1;
      throw new Error("must not ask");
    },
  });

  const trusted = [
    [
      "mcp__leileios__get_current_time",
      "leileios_read",
    ],
    [
      "mcp__leileios__read_todo_day",
      "leileios_read",
    ],
    [
      "mcp__leileios_local__send_file",
      "leileios_local_send_file",
    ],
  ];

  for (const [toolName, policy] of trusted) {
    assert.equal(
      trustedNativeLiveToolPolicy(toolName),
      policy,
    );
    assert.equal(isTrustedLeileiosTool(toolName), true);
    assert.deepEqual(
      await callback(toolName, {}, {}),
      { behavior: "allow" },
    );
  }

  assert.equal(permissionCalls, 0);
});

test("Read bypasses permission only for exact materialized attachment paths", async () => {
  const attachmentPath =
    "/tmp/leileios-native-live-inbox/c/p/a/photo.webp";
  let permissionCalls = 0;
  const callback = createAgentSdkPermissionCallback({
    trustedReadPaths: [attachmentPath],
    permissionHandler: async () => {
      permissionCalls += 1;
      return { decision: "allow" };
    },
  });

  assert.equal(
    trustedNativeLiveToolPolicy(
      "Read",
      { file_path: attachmentPath },
      { trustedReadPaths: [attachmentPath] },
    ),
    "native_live_attachment_read",
  );
  assert.deepEqual(
    await callback(
      "Read",
      {
        file_path: attachmentPath,
        offset: 1,
        limit: 10,
      },
      {},
    ),
    { behavior: "allow" },
  );
  assert.equal(permissionCalls, 0);

  assert.equal(
    trustedNativeLiveToolPolicy(
      "Read",
      {
        file_path:
          attachmentPath + ".neighbor",
      },
      { trustedReadPaths: [attachmentPath] },
    ),
    null,
  );
  assert.deepEqual(
    await callback(
      "Read",
      {
        file_path:
          attachmentPath + ".neighbor",
      },
      {},
    ),
    { behavior: "allow" },
  );
  assert.equal(permissionCalls, 1);
});

test("future unknown local tools do not inherit trust automatically", async () => {
  let permissionCalls = 0;
  const callback = createAgentSdkPermissionCallback({
    permissionHandler: async () => {
      permissionCalls += 1;
      return { decision: "allow" };
    },
  });

  for (const toolName of [
    "mcp__leileios_album__delete_photo",
    "mcp__leileios_local__arbitrary_file_action",
  ]) {
    assert.equal(
      trustedNativeLiveToolPolicy(toolName),
      null,
    );
    assert.equal(isTrustedLeileiosTool(toolName), false);
    assert.deepEqual(
      await callback(toolName, {}, {}),
      { behavior: "allow" },
    );
  }

  assert.equal(permissionCalls, 2);
});

test("retired photo album tools never receive trusted automatic permission", async () => {
  let calls = 0;
  const callback = createAgentSdkPermissionCallback({
    permissionHandler: async () => {
      calls += 1;
      return { decision: "deny", message: "Retired tool" };
    },
  });
  for (const name of ["save_photo", "search_photos", "view_photo", "send_photo"]) {
    const tool = `mcp__leileios_album__${name}`;
    assert.equal(trustedNativeLiveToolPolicy(tool), null);
    assert.equal((await callback(tool, {}, {})).behavior, "deny");
  }
  assert.equal(calls, 4);
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

test("retired meme and unknown tools have no trusted policy and require permission", async () => {
  let calls = 0;
  const callback = createAgentSdkPermissionCallback({permissionHandler: async () => {
    calls++; return {decision: "deny", message: "untrusted"};
  }});
  for (const name of ["mcp__leileios_memes__send_meme", "mcp__leileios_memes__search_memes", "mcp__leileios_memes__fetch_url", "mcp__leileios_memes__github"]) {
    assert.equal(trustedNativeLiveToolPolicy(name), null);
    assert.equal((await callback(name, {}, {})).behavior, "deny");
  }
  assert.equal(calls, 4);
});

test("LeileiOS mutations, destructive and unknown tools always enter the permission handler", async () => {
  const requests = [];
  const callback = createAgentSdkPermissionCallback({ permissionHandler: async (request) => {
    requests.push(request);
    return { decision: "deny", message: "approval required", interrupt: false };
  } });
  for (const name of [
    "create_diary", "write_diary", "update_diary", "append_todo_entries", "append_todo_entry", "write_todo_paper", "update_todo_entries", "delete_todo_entries",
    "create_universe_node", "update_universe_node", "delete_universe_node", "create_universe_relation", "delete_universe_relation",
    "delete_universe_diary_source", "write_notion_page", "unknown_read_tool", "get_current_time_and_delete_everything",
  ]) {
    const toolName = `mcp__leileios__${name}`;
    assert.equal(trustedNativeLiveToolPolicy(toolName), null, toolName);
    assert.equal(isTrustedLeileiosTool(toolName), false, toolName);
    const count = requests.length;
    assert.deepEqual(await callback(toolName, { value: "unchanged" }, {}), { behavior: "deny", message: "approval required", interrupt: false });
    assert.equal(requests.length, count + 1);
    assert.equal(requests.at(-1).toolName, toolName);
    assert.deepEqual(requests.at(-1).input, { value: "unchanged" });
  }
});


test("explicit LeileiOS read allowlist contains only registered pure reads", async () => {
  let calls = 0;
  const callback = createAgentSdkPermissionCallback({ permissionHandler: async () => { calls += 1; throw new Error("read should not ask"); } });
  for (const name of ["get_current_time", "get_health", "global_search", "search_diary", "get_diary", "get_diary_comment", "list_diary_comments", "search_todo", "list_todo_dates", "read_todo_day", "list_universe_galaxies", "list_universe_nodes", "get_universe_node", "get_universe_relations", "get_universe_diary_sources", "search_notion", "read_notion_page", "get_notion_connection", "read_notion_database", "read_notion_data_source"]) {
    assert.equal(trustedNativeLiveToolPolicy(`mcp__leileios__${name}`), "leileios_read");
    assert.deepEqual(await callback(`mcp__leileios__${name}`, {}, {}), { behavior: "allow" });
  }
  assert.equal(calls, 0);
});

test("owner auto-allow approves native and external tools without a permission interaction", async () => {
  const events = new EventEmitter(), requests = [], decisions = [];
  events.on("permission-request", request => requests.push(request));
  events.on("permission-decision", decision => decisions.push(decision));
  const callback = createAgentSdkPermissionCallback({
    toolPermissionPolicy: "auto_allow", events,
    permissionHandler: () => assert.fail("must not ask the owner for tool permission"),
  });
  for (const tool of ["Bash", "Write", "Edit", "Read", "Monitor", "WebFetch", "Artifact", "Skill", "ExitPlanMode", "mcp__external__write", "FutureTool"]) {
    assert.deepEqual(await callback(tool, { synthetic: true }, { toolUseID: tool }), { behavior: "allow" });
  }
  assert.equal(requests.length, 0);
  assert.equal(decisions.length, 11);
  assert.ok(decisions.every(event => event.trustedPolicy === "owner_auto_allow"));
});

test("auto-allow without a question handler does not invent AskUserQuestion answers", async () => {
  const callback = createAgentSdkPermissionCallback({ toolPermissionPolicy: "auto_allow" });
  const decision = await callback("AskUserQuestion", { questions: [{ question: "Synthetic?", options: [] }] });
  assert.equal(decision.behavior, "deny");
  assert.match(decision.message, /question handler/i);
});

test("auto-allow rejects an already cancelled tool request", async () => {
  const events = new EventEmitter(), requests = [];
  events.on("permission-request", request => requests.push(request));
  const callback = createAgentSdkPermissionCallback({
    toolPermissionPolicy: "auto_allow", events,
    permissionHandler: () => assert.fail("cancelled requests must not ask"),
  });
  const decision = await callback("Bash", { command: "synthetic" }, { signal: AbortSignal.abort() });
  assert.equal(decision.behavior, "deny");
  assert.equal(decision.interrupt, true);
  assert.match(decision.message, /cancelled/i);
  assert.equal(requests.length, 0);
});

test("an invalid tool permission policy cannot silently enable automatic approval", () => {
  assert.throws(() => createAgentSdkPermissionCallback({ toolPermissionPolicy: "allow_everything_typo", permissionHandler() {} }), /permission policy/i);
});
