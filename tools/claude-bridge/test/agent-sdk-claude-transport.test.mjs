import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentSdkClaudeTransport,
} from "../src/agent-sdk-claude-transport.mjs";

function fakeQuery(messages, { error = null } = {}) {
  let closed = false;
  return {
    get closed() {
      return closed;
    },
    close() {
      closed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const message of messages) {
        yield message;
      }
      if (error) throw error;
    },
  };
}

function fakeConnectedMcpQuery(messages) {
  return {
    ...fakeQuery(messages),
    async mcpServerStatus() {
      return [{
        name: "leileios",
        status: "connected",
      }];
    },
    async reconnectMcpServer() {},
  };
}

function successFixture(sessionId = "provider-sdk-1") {
  return [
    {
      type: "system",
      subtype: "init",
      session_id: sessionId,
    },
    {
      type: "assistant",
      session_id: sessionId,
      message: {
        content: [{ type: "text", text: "READY" }],
      },
    },
    {
      type: "result",
      subtype: "success",
      session_id: sessionId,
      result: "READY",
    },
  ];
}

test("sendNew preserves Claude Code settings and normalized event parity", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: { HOME: "/Users/leilei" },
    cwd: "/workspace/leilei-os",
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture());
    },
  });

  const emitted = [];
  transport.events.on("normalized-event", (event) => {
    emitted.push(event);
  });

  const result = await transport.sendNew("remember this");

  assert.deepEqual(call, {
    prompt: "remember this",
    options: {
      cwd: "/workspace/leilei-os",
      env: {
        HOME: "/Users/leilei",
        DISABLE_AUTO_COMPACT: "1",
      },
      settingSources: ["user", "project", "local"],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
      },
      verbatimPrompts: true,
    },
  });
  assert.equal(result.providerSessionId, "provider-sdk-1");
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "text", "result"],
  );
  assert.deepEqual(result.normalizedEvents, emitted);
});

test("explicit model/thinking/effort selection reaches query options and returns applied readback", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async getSettings() {
          return {
            applied: {
              model: "claude-opus-5-5",
              effort: "medium",
            },
          };
        },
        async supportedModels() {
          return [
            {
              value: "claude-opus-5-5",
              displayName: "Claude Opus 5.5",
              description: "test",
              supportsEffort: true,
              supportedEffortLevels: [
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ],
              supportsAdaptiveThinking: true,
            },
          ];
        },
        async *[Symbol.asyncIterator]() {
          for (const message of successFixture("provider-model")) {
            yield message;
          }
        },
      };
    },
  });

  const result = await transport.sendNew("hello", {
    model: "claude-opus-5-5",
    thinking: "adaptive",
    effort: "medium",
  });

  assert.equal(call.options.model, "claude-opus-5-5");
  assert.deepEqual(call.options.thinking, { type: "adaptive" });
  assert.equal(call.options.effort, "medium");
  assert.equal(result.executionReadbackError, null);
  assert.deepEqual(result.executionReadback.applied, {
    model: "claude-opus-5-5",
    effort: "medium",
  });
  assert.equal(
    result.executionReadback.capability.supports_adaptive_thinking,
    true,
  );
});

test("resume passes provider session identity without forking", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-root"));
    },
  });

  const result = await transport.resume(
    "provider-root",
    "what was it?",
  );

  assert.equal(call.options.resume, "provider-root");
  assert.equal("forkSession" in call.options, false);
  assert.equal(result.providerSessionId, "provider-root");
});

test("fork uses resume plus forkSession and requires a new provider session id", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-fork"));
    },
  });

  const result = await transport.fork(
    "provider-root",
    "branch prompt",
  );

  assert.equal(call.options.resume, "provider-root");
  assert.equal(call.options.forkSession, true);
  assert.equal(result.providerSessionId, "provider-fork");

  const conflicting = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: () => fakeQuery(successFixture("provider-root")),
  });
  await assert.rejects(
    () => conflicting.fork("provider-root", "branch prompt"),
    (error) =>
      error.runtimeCode === "PROVIDER_SESSION_CONFLICT"
      && /same provider session id/i.test(error.message),
  );
});

test("resume and fork reject an absent local parent transcript before query", async () => {
  let queryCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async (sessionId, options) => {
      assert.equal(sessionId, "missing-parent");
      assert.deepEqual(options, {
        dir: "/workspace/leilei-os",
        limit: 1,
      });
      return [];
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  for (const run of [
    () => transport.resume("missing-parent", "resume"),
    () => transport.fork("missing-parent", "fork"),
  ]) {
    await assert.rejects(
      run,
      (error) =>
        error.runtimeCode === "NO_PROVIDER_SESSION"
        && error.parentSessionId === "missing-parent"
        && /complete durable transcript/i.test(error.message),
    );
  }
  assert.equal(queryCalls, 0);
});

test("durable SessionStore resumes when the local transcript is absent", async () => {
  let call;
  const statusCalls = [];
  let state = "complete";
  const durableStore = {
    async append() {},
    async load(key) {
      assert.equal(key.sessionId, "provider-remote");
      return [{ type: "user", message: { role: "user", content: "hello" } }];
    },
    async getStatus(sessionId) {
      assert.equal(sessionId, "provider-remote");
      return state;
    },
    async markIncomplete(sessionId) {
      assert.equal(sessionId, "provider-remote");
      statusCalls.push("incomplete");
      state = "incomplete";
    },
    async markComplete(sessionId) {
      assert.equal(sessionId, "provider-remote");
      statusCalls.push("complete");
      state = "complete";
    },
    async delete() {},
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [],
    sessionStore: durableStore,
    queryImpl: (input) => {
      call = input;
      return fakeQuery(successFixture("provider-remote"));
    },
  });

  const result = await transport.resume(
    "provider-remote",
    "continue",
  );

  assert.equal(result.providerSessionId, "provider-remote");
  assert.equal(call.options.resume, "provider-remote");
  assert.equal(call.options.sessionStore, durableStore);
  assert.deepEqual(statusCalls, ["incomplete", "complete"]);
  assert.equal(state, "complete");
});

test("durable SessionStore failures remain fail-closed", async () => {
  const cause = new Error("remote transcript unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: {
      async append() {},
      async getStatus() { return "complete"; },
      async load() {
        throw cause;
      },
    },
    queryImpl: () => fakeQuery(successFixture("unexpected")),
  });

  await assert.rejects(
    () => transport.resume("provider-remote", "continue"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /durable Claude Agent SDK parent session/i.test(error.message),
  );
});

test("remote-only resume rejects incomplete transcript before query", async () => {
  let queryCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: {
      async append() {},
      async getStatus() { return "incomplete"; },
      async load() {
        throw new Error("incomplete transcript must not be loaded");
      },
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  await assert.rejects(
    () => transport.resume("provider-incomplete", "continue"),
    (error) =>
      error.runtimeCode === "NO_PROVIDER_SESSION"
      && /complete durable transcript/i.test(error.message),
  );
  assert.equal(queryCalls, 0);
});

test("complete local resume fails before query if completeness cannot be invalidated", async () => {
  let queryCalls = 0;
  const cause = new Error("status write unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: {
      async append() {},
      async getStatus() { return "complete"; },
      async markIncomplete() { throw cause; },
      async load() { return [{ type: "assistant" }]; },
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("unexpected"));
    },
  });

  await assert.rejects(
    () => transport.resume("provider-root", "continue"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /mark durable Claude Agent SDK session incomplete/i.test(error.message),
  );
  assert.equal(queryCalls, 0);
});

test("mirror_error leaves a previously complete session incomplete", async () => {
  let state = "complete";
  const statusCalls = [];
  const discarded = [];
  const durableStore = {
    async append() {},
    async getStatus() { return state; },
    discardPendingAppends(sessionId) {
      discarded.push(sessionId);
    },
    async markIncomplete() {
      state = "incomplete";
      statusCalls.push("incomplete");
    },
    async markComplete() {
      state = "complete";
      statusCalls.push("complete");
    },
    async load() { return [{ type: "assistant" }]; },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: durableStore,
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-root",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-root",
        error: "remote append failed",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-root",
        result: "READY",
      },
    ]),
  });

  const result = await transport.resume("provider-root", "continue");
  assert.equal(result.providerSessionId, "provider-root");
  assert.deepEqual(statusCalls, ["incomplete"]);
  assert.deepEqual(discarded, ["provider-root"]);
  assert.equal(state, "incomplete");
});

test("legacy local session is backfilled before it becomes portable", async () => {
  let imported = false;
  let state = null;
  const statusCalls = [];
  let importArgs;
  const durableStore = {
    async append() {},
    async getStatus() { return state; },
    async load() {
      return imported ? [{ type: "assistant", old: true }] : null;
    },
    async markIncomplete() {
      state = "incomplete";
      statusCalls.push("incomplete");
    },
    async markComplete() {
      state = "complete";
      statusCalls.push("complete");
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: durableStore,
    importSessionToStoreImpl: async (sessionId, store, options) => {
      importArgs = { sessionId, store, options };
      imported = true;
    },
    queryImpl: () => fakeQuery(successFixture("legacy-local")),
  });

  await transport.resume("legacy-local", "continue");

  assert.deepEqual(importArgs, {
    sessionId: "legacy-local",
    store: durableStore,
    options: {
      dir: "/workspace/leilei-os",
      includeSubagents: true,
      batchSize: 500,
    },
  });
  assert.deepEqual(
    statusCalls,
    ["complete", "incomplete", "complete"],
  );
  assert.equal(state, "complete");
});

test("legacy local session keeps working if durable backfill fails", async () => {
  let queryCalls = 0;
  let completeCalls = 0;
  const backfillError = new Error("remote store unavailable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    sessionStore: {
      async append() {},
      async getStatus() { return null; },
      async load() { return null; },
      async markComplete() { completeCalls += 1; },
    },
    importSessionToStoreImpl: async () => {
      throw backfillError;
    },
    queryImpl: () => {
      queryCalls += 1;
      return fakeQuery(successFixture("legacy-local"));
    },
  });

  const errors = [];
  transport.events.on("session-store-backfill-error", (error) => {
    errors.push(error);
  });

  const result = await transport.resume("legacy-local", "continue");

  assert.equal(result.providerSessionId, "legacy-local");
  assert.equal(queryCalls, 1);
  assert.equal(completeCalls, 0);
  assert.deepEqual(errors, [backfillError]);
});

test("new session becomes portable only after a readable mirrored transcript exists", async () => {
  let completeCalls = 0;
  const durableStore = {
    async append() {},
    async load(key) {
      assert.equal(key.sessionId, "provider-new-portable");
      return [{ type: "user", text: "mirrored" }];
    },
    async markComplete(sessionId) {
      assert.equal(sessionId, "provider-new-portable");
      completeCalls += 1;
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionStore: durableStore,
    queryImpl: () => fakeQuery(successFixture("provider-new-portable")),
  });

  await transport.sendNew("hello");
  assert.equal(completeCalls, 1);
});

test("new session stays non-portable when mirror_error is emitted", async () => {
  let completeCalls = 0;
  const durableStore = {
    async append() {},
    async load() {
      throw new Error("must not probe a failed mirror");
    },
    async markComplete() {
      completeCalls += 1;
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionStore: durableStore,
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-new-incomplete",
      },
      {
        type: "system",
        subtype: "mirror_error",
        session_id: "provider-new-incomplete",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-new-incomplete",
        result: "READY",
      },
    ]),
  });

  await transport.sendNew("hello");
  assert.equal(completeCalls, 0);
});

test("fork keeps a complete parent readable and marks only the mirrored child complete", async () => {
  const statusCalls = [];
  const durableStore = {
    async append() {},
    async getStatus(sessionId) {
      assert.equal(sessionId, "provider-parent");
      return "complete";
    },
    async load(key) {
      return [{ type: "assistant", session: key.sessionId }];
    },
    async markIncomplete(sessionId) {
      statusCalls.push(["incomplete", sessionId]);
    },
    async markComplete(sessionId) {
      statusCalls.push(["complete", sessionId]);
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [],
    sessionStore: durableStore,
    queryImpl: () => fakeQuery(successFixture("provider-child")),
  });

  const result = await transport.fork("provider-parent", "branch");
  assert.equal(result.providerSessionId, "provider-child");
  assert.deepEqual(statusCalls, [["complete", "provider-child"]]);
});

test("Agent SDK deletion receives the durable SessionStore", async () => {
  let deletion;
  const durableStore = {
    async append() {},
    async load() { return null; },
    async delete() {},
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionStore: durableStore,
    deleteSessionImpl: async (sessionId, options) => {
      deletion = { sessionId, options };
    },
  });

  await transport.deleteSession("provider-delete");

  assert.deepEqual(deletion, {
    sessionId: "provider-delete",
    options: {
      dir: "/workspace/leilei-os",
      sessionStore: durableStore,
    },
  });
});

test("session preflight read failures stay RUNTIME_UNAVAILABLE", async () => {
  const cause = new Error("session store unreadable");
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => {
      throw cause;
    },
    queryImpl: () => fakeQuery(successFixture("unexpected")),
  });

  await assert.rejects(
    () => transport.fork("provider-root", "branch prompt"),
    (error) =>
      error.runtimeCode === "RUNTIME_UNAVAILABLE"
      && error.cause === cause
      && /failed to inspect/i.test(error.message),
  );
});

test("normal turns expose the latest live context usage with provider auto-compact disabled", async () => {
  let usageCalls = 0;
  let queryInput;
  const transport = new AgentSdkClaudeTransport({
    environment: { DISABLE_AUTO_COMPACT: "0" },
    queryImpl: (input) => {
      queryInput = input;
      return {
        close() {},
        async getContextUsage() {
        usageCalls += 1;
        const percentage =
          usageCalls === 1 ? 74 : usageCalls === 2 ? 75 : 76;
        return {
          model: "claude-opus-5-5",
          totalTokens: percentage * 10000,
          maxTokens: 1000000,
          rawMaxTokens: 1000000,
          percentage,
          categories: [
            {
              name: "Messages",
              tokens: percentage * 9000,
              kind: "used",
            },
          ],
        };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-context",
        };
        yield {
          type: "assistant",
          session_id: "provider-context",
          message: {
            content: [{ type: "text", text: "working" }],
          },
        };
        yield {
          type: "assistant",
          session_id: "provider-context",
          message: {
            content: [{ type: "text", text: "READY" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-context",
          result: "READY",
        };
      },
      };
    },
  });

  const result = await transport.sendNew("hello");
  assert.equal(usageCalls, 3);

  assert.deepEqual(result.contextUsage, {
    model: "claude-opus-5-5",
    total_tokens: 760000,
    max_tokens: 1000000,
    raw_max_tokens: 1000000,
    percentage: 76,
    categories: [
      {
        name: "Messages",
        tokens: 684000,
        kind: "used",
        is_deferred: null,
      },
    ],
  });
  assert.equal(result.contextUsageError, null);
  assert.equal(
    queryInput.options.env.DISABLE_AUTO_COMPACT,
    "1",
  );
});

test("compact uses a dedicated non-verbatim control path and returns lifecycle observability", async () => {
  let call;
  let compactUsageCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async getContextUsage() {
          compactUsageCalls += 1;
          if (compactUsageCalls > 1) {
            throw new Error("query already finished");
          }
          return {
            model: "claude-opus-5-5",
            totalTokens: 1302,
            maxTokens: 1000000,
            rawMaxTokens: 1000000,
            percentage: 0.1302,
            categories: [],
          };
        },
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-root",
          };

          await input.options.hooks.PreCompact[0].hooks[0]({
            hook_event_name: "PreCompact",
            trigger: "manual",
            custom_instructions: null,
          });

          yield {
            type: "system",
            subtype: "compact_boundary",
            session_id: "provider-root",
            compact_metadata: {
              trigger: "manual",
              pre_tokens: 28485,
              post_tokens: 1302,
              duration_ms: 10123,
              preserved_segment: {
                head_uuid: "head",
                anchor_uuid: "anchor",
                tail_uuid: "tail",
              },
            },
          };

          await input.options.hooks.PostCompact[0].hooks[0]({
            hook_event_name: "PostCompact",
            trigger: "manual",
            compact_summary: "summary with durable marker",
          });

          yield {
            type: "result",
            subtype: "success",
            session_id: "provider-root",
            result: "",
          };
        },
      };
    },
  });

  const result = await transport.compact("provider-root");

  assert.equal(compactUsageCalls, 2);
  assert.equal(call.prompt, "/compact");
  assert.equal(call.options.resume, "provider-root");
  assert.equal(call.options.verbatimPrompts, false);
  assert.ok(call.options.hooks);
  assert.equal(result.providerSessionId, "provider-root");
  assert.deepEqual(result.contextUsage, {
    model: "claude-opus-5-5",
    total_tokens: 1302,
    max_tokens: 1000000,
    raw_max_tokens: 1000000,
    percentage: 0.1302,
    categories: [],
  });
  assert.deepEqual(result.compaction.boundary, {
    trigger: "manual",
    pre_tokens: 28485,
    post_tokens: 1302,
    duration_ms: 10123,
    preserved_segment: {
      head_uuid: "head",
      anchor_uuid: "anchor",
      tail_uuid: "tail",
    },
  });
  assert.deepEqual(result.compaction.preCompact, [
    {
      hookEventName: "PreCompact",
      trigger: "manual",
      customInstructions: null,
    },
  ]);
  assert.deepEqual(result.compaction.postCompact, [
    {
      hookEventName: "PostCompact",
      trigger: "manual",
      summary: "summary with durable marker",
    },
  ]);
});

test("compact refuses to claim success if the SDK emits no compact boundary", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-root",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "provider-root",
        result: "",
      },
    ]),
  });

  await assert.rejects(
    () => transport.compact("provider-root"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /without a compact boundary/i.test(error.message),
  );
});

test("SDK terminal error results map into existing runtime failure semantics", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => fakeQuery([
      {
        type: "system",
        subtype: "init",
        session_id: "provider-sdk-failure",
      },
      {
        type: "result",
        subtype: "error_during_execution",
        session_id: "provider-sdk-failure",
        errors: ["permission denied"],
      },
    ]),
  });

  await assert.rejects(
    () => transport.sendNew("hello"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /permission denied/i.test(error.message),
  );
});

test("query transport exceptions map into existing process failure semantics", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () =>
      fakeQuery([], { error: new Error("sdk subprocess died") }),
  });

  await assert.rejects(
    () => transport.sendNew("hello"),
    (error) =>
      error.runtimeCode === "CLAUDE_PROCESS_FAILED"
      && /sdk subprocess died/i.test(error.message),
  );
});

test("abort closes the active SDK query and reports ABORTED", async () => {
  let release;
  let active;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => {
      let closed = false;
      active = {
        close() {
          closed = true;
          release();
        },
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-abort",
          };
          await gate;
          if (!closed) {
            yield {
              type: "result",
              subtype: "success",
              session_id: "provider-abort",
              result: "should not finish",
            };
          }
        },
      };
      return active;
    },
  });

  const run = transport.sendNew("long task");
  await new Promise((resolve) => setImmediate(resolve));
  transport.abort();

  await assert.rejects(
    () => run,
    (error) => error.runtimeCode === "ABORTED",
  );
  assert.ok(active);
});

test("refuses API-key mode and keeps subscription-auth boundary", () => {
  assert.throws(
    () =>
      new AgentSdkClaudeTransport({
        environment: { ANTHROPIC_API_KEY: "forbidden" },
        queryImpl: () => fakeQuery([]),
      }),
    /ANTHROPIC_API_KEY/,
  );
});

test("SDK loading stays lazy so the old transport remains a valid rollback", async () => {
  let loadCalls = 0;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    loadQuery: async () => {
      loadCalls += 1;
      return () => fakeQuery(successFixture("lazy-provider"));
    },
  });

  assert.equal(loadCalls, 0);
  const result = await transport.sendNew("hello");
  assert.equal(loadCalls, 1);
  assert.equal(result.providerSessionId, "lazy-provider");
});


test("interactive foreground execution uses the dedicated turn handle with verbatim streaming", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "provider-interactive-child",
          };
          yield {
            type: "stream_event",
            session_id: "provider-interactive-child",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "hel",
              },
            },
          };
          yield {
            type: "result",
            subtype: "success",
            session_id: "provider-interactive-child",
            result: "hello",
          };
        },
      };
    },
  });

  const emitted = [];
  const delivered = [];
  transport.events.on("normalized-event", (event) => {
    emitted.push(event.type);
  });

  const result = await transport.executeTurn(
    "branch prompt",
    {
      mode: "fork",
      parentProviderSessionId: "provider-parent",
      streaming: true,
      onNormalizedEvent: async (event) => {
        delivered.push(event.type);
      },
    },
  );

  assert.equal(
    typeof call.prompt?.[Symbol.asyncIterator],
    "function",
  );
  assert.equal(call.options.resume, "provider-parent");
  assert.equal(call.options.forkSession, true);
  assert.equal(call.options.verbatimPrompts, true);
  assert.equal(call.options.includePartialMessages, true);
  assert.equal(
    result.providerSessionId,
    "provider-interactive-child",
  );
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "partial_text", "result"],
  );
  assert.deepEqual(
    emitted,
    ["session", "partial_text", "result"],
  );
  assert.deepEqual(
    delivered,
    ["session", "partial_text", "result"],
  );
});

test("interactive foreground event delivery failure is observability-only", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        for (const message of successFixture("provider-event-fail-soft")) {
          yield message;
        }
      },
    }),
  });

  const failures = [];
  transport.events.on(
    "event-delivery-error",
    (error) => failures.push(error),
  );

  let attempts = 0;
  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      onNormalizedEvent: async () => {
        attempts += 1;
        throw new Error("event delivery unavailable");
      },
    },
  );

  assert.equal(
    result.providerSessionId,
    "provider-event-fail-soft",
  );
  assert.equal(attempts, 3);
  assert.equal(failures.length, 1);
});


test("interactive foreground execution binds permission and question host callbacks", async () => {
  const sdkDecisions = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: ({ options }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        sdkDecisions.push(
          await options.canUseTool(
            "Write",
            { file_path: "/tmp/a", content: "x" },
            {
              toolUseID: "tool-write-1",
              requestId: "request-write-1",
            },
          ),
        );
        sdkDecisions.push(
          await options.canUseTool(
            "AskUserQuestion",
            {
              questions: [{
                question: "Theme",
                options: [
                  { label: "Light" },
                  { label: "Dark" },
                ],
              }],
            },
            {
              toolUseID: "tool-question-1",
              requestId: "request-question-1",
            },
          ),
        );
        for (const message of successFixture("provider-interactions")) {
          yield message;
        }
      },
    }),
  });

  const requests = [];
  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      permissionHandler: async (request) => {
        requests.push(["permission", request]);
        return {
          decision: "allow",
          updatedInput: {
            file_path: "/allowed/a",
            content: "rewritten",
          },
        };
      },
      questionHandler: async (request) => {
        requests.push(["question", request]);
        return {
          decision: "answer",
          answers: {
            Theme: "Dark",
          },
        };
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-interactions");
  assert.deepEqual(
    requests.map(([kind]) => kind),
    ["permission", "question"],
  );
  assert.deepEqual(sdkDecisions, [
    {
      behavior: "allow",
      updatedInput: {
        file_path: "/allowed/a",
        content: "rewritten",
      },
    },
    {
      behavior: "allow",
      updatedInput: {
        questions: [{
          question: "Theme",
          options: [
            { label: "Light" },
            { label: "Dark" },
          ],
        }],
        answers: {
          Theme: "Dark",
        },
      },
    },
  ]);
});


test("interactive foreground control pump can queue a mid-turn user message on the same SDK query", async () => {
  const seenUserMessages = [];
  const receipts = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: ({ prompt }) => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        const iterator = prompt[Symbol.asyncIterator]();
        const first = await iterator.next();
        seenUserMessages.push(
          first.value.message.content[0].text,
        );
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-controlled",
        };
        const second = await iterator.next();
        seenUserMessages.push(
          second.value.message.content[0].text,
        );
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-controlled",
          result: "UPDATED",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "initial",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      controlPump: async (controller) => {
        await new Promise((resolve) => setImmediate(resolve));
        receipts.push(
          controller.sendUserMessage("mid-turn update"),
        );
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-controlled");
  assert.deepEqual(seenUserMessages, [
    "initial",
    "mid-turn update",
  ]);
  assert.deepEqual(receipts, [{ status: "queued" }]);
});

test("interactive foreground control pump projects graceful interrupt as INTERRUPTED", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {
        release();
      },
      async interrupt() {
        release();
        return { still_queued: [] };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-interrupt-control",
        };
        await gate;
        throw new Error("provider interrupted execution");
      },
    }),
  });

  await assert.rejects(
    () =>
      transport.executeTurn(
        "long task",
        {
          mode: "new",
          parentProviderSessionId: null,
          streaming: true,
          controlPump: async (controller) => {
            await new Promise((resolve) => setImmediate(resolve));
            await controller.interrupt();
          },
        },
      ),
    (error) => error.runtimeCode === "INTERRUPTED",
  );
});


test("interactive foreground execution applies model thinking and effort selection", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successFixture("provider-selected-interactive")) {
            yield message;
          }
        },
      };
    },
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      execution: {
        model: "claude-sonnet-5",
        thinking: "adaptive",
        effort: "xhigh",
      },
    },
  );

  assert.equal(result.providerSessionId, "provider-selected-interactive");
  assert.equal(call.options.model, "claude-sonnet-5");
  assert.deepEqual(call.options.thinking, { type: "adaptive" });
  assert.equal(call.options.effort, "xhigh");
  assert.equal(call.options.verbatimPrompts, true);
});


test("interactive foreground returns turn-boundary context usage without auto-compaction policy", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async getContextUsage() {
        return {
          model: "claude-opus-5-5",
          totalTokens: 760000,
          maxTokens: 1000000,
          rawMaxTokens: 1000000,
          percentage: 76,
          categories: [{
            name: "Messages",
            tokens: 700000,
            kind: "used",
            isDeferred: false,
          }],
        };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-context-interactive",
        };
        yield {
          type: "assistant",
          session_id: "provider-context-interactive",
          message: {
            content: [{ type: "text", text: "done" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-context-interactive",
          result: "done",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
    },
  );

  assert.deepEqual(result.contextUsage, {
    model: "claude-opus-5-5",
    total_tokens: 760000,
    max_tokens: 1000000,
    raw_max_tokens: 1000000,
    percentage: 76,
    categories: [{
      name: "Messages",
      tokens: 700000,
      kind: "used",
      is_deferred: false,
    }],
  });
  assert.equal(result.contextUsageError, null);
});


test("interactive foreground returns execution readback for the exact requested selection", async () => {
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    queryImpl: () => ({
      close() {},
      async getSettings() {
        return {
          applied: {
            model: "claude-opus-5-5",
            effort: "high",
          },
        };
      },
      async supportedModels() {
        return [{
          value: "claude-opus-5-5",
          displayName: "Claude Opus 5.5",
          description: "test model",
          supportsEffort: true,
          supportedEffortLevels: [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
          ],
          supportsAdaptiveThinking: true,
          supportsFastMode: false,
          supportsAutoMode: false,
        }];
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-execution-readback",
        };
        yield {
          type: "assistant",
          session_id: "provider-execution-readback",
          message: {
            content: [{ type: "text", text: "done" }],
          },
        };
        yield {
          type: "result",
          subtype: "success",
          session_id: "provider-execution-readback",
          result: "done",
        };
      },
    }),
  });

  const result = await transport.executeTurn(
    "hello",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
      execution: {
        model: "claude-opus-5-5",
        thinking: "adaptive",
        effort: "high",
      },
    },
  );

  assert.equal(result.executionReadbackError, null);
  assert.deepEqual(result.executionReadback, {
    requested: {
      model: "claude-opus-5-5",
      thinking: "adaptive",
      effort: "high",
    },
    applied: {
      model: "claude-opus-5-5",
      effort: "high",
    },
    capability: {
      value: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      description: "test model",
      supports_effort: true,
      supported_effort_levels: [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
      supports_adaptive_thinking: true,
      supports_fast_mode: false,
      supports_auto_mode: false,
    },
    supported_models: [{
      value: "claude-opus-5-5",
      display_name: "Claude Opus 5.5",
      description: "test model",
      supports_effort: true,
      supported_effort_levels: [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
      supports_adaptive_thinking: true,
      supports_fast_mode: false,
      supports_auto_mode: false,
    }],
  });
});


test("deleteSession delegates to Agent SDK with the daemon cwd", async () => {
  const calls = [];
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    queryImpl: () => fakeQuery([]),
    deleteSessionImpl: async (sessionId, options) => {
      calls.push({ sessionId, options });
    },
  });

  await transport.deleteSession("provider-old");

  assert.deepEqual(calls, [{
    sessionId: "provider-old",
    options: { dir: "/workspace/leilei-os" },
  }]);
});


test("listSessions reads the current workspace without mutating any session", async () => {
  let options;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    cwd: "/workspace/leilei-os",
    listSessionsImpl: async (input) => {
      options = input;
      return [
        {
          sessionId: "external-session-1",
          summary: "Current Claude Code work",
          customTitle: "Runtime work",
          firstPrompt: "continue",
          gitBranch: "main",
          cwd: "/workspace/leilei-os",
          lastModified: 123,
          createdAt: 100,
        },
      ];
    },
  });

  const sessions = await transport.listSessions();

  assert.deepEqual(options, {
    dir: "/workspace/leilei-os",
    limit: 100,
    offset: 0,
    includeWorktrees: false,
  });
  assert.deepEqual(sessions, [
    {
      sessionId: "external-session-1",
      summary: "Current Claude Code work",
      customTitle: "Runtime work",
      firstPrompt: "continue",
      gitBranch: "main",
      cwd: "/workspace/leilei-os",
      lastModified: 123,
      createdAt: 100,
    },
  ]);
});


test("LeileiOS MCP is injected into every foreground Agent SDK turn", async () => {
  let call;
  const mcpServerConfig = {
    type: "http",
    url: "https://leilei-os.example/internal/native-live-mcp",
    headers: {
      Authorization: "Bearer relay-secret",
    },
  };
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig,
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(successFixture("provider-mcp"));
    },
  });

  const result = await transport.executeTurn(
    "read today's todo",
    {
      mode: "new",
      parentProviderSessionId: null,
      streaming: true,
    },
  );

  assert.equal(result.providerSessionId, "provider-mcp");
  assert.deepEqual(call.options.mcpServers, {
    leileios: mcpServerConfig,
  });
  assert.equal(call.options.allowedTools, undefined);
});

test("LeileiOS MCP is also injected into non-interactive resume turns", async () => {
  let call;
  const transport = new AgentSdkClaudeTransport({
    environment: {},
    mcpServerConfig: {
      type: "http",
      url: "https://leilei-os.example/internal/native-live-mcp",
      headers: {
        Authorization: "Bearer relay-secret",
      },
    },
    sessionMessagesImpl: async () => [{ type: "assistant" }],
    queryImpl: (input) => {
      call = input;
      return fakeConnectedMcpQuery(successFixture("provider-existing"));
    },
  });

  await transport.resume("provider-existing", "continue");

  assert.equal(call.options.resume, "provider-existing");
  assert.equal(
    call.options.mcpServers.leileios.url,
    "https://leilei-os.example/internal/native-live-mcp",
  );
  assert.equal(call.options.allowedTools, undefined);
});
