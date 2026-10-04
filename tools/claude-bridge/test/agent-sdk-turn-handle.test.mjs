import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSdkTurnHandle,
} from "../src/agent-sdk-turn-handle.mjs";

function successMessages(sessionId = "provider-turn") {
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

test("turn handle completes a normal SDK turn without changing the phase-1 transport", async () => {
  let call;
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    userMessageUuid:
      "44444444-4444-4444-8444-444444444444",
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages()) {
            yield message;
          }
        },
      };
    },
  });

  assert.equal(
    typeof call.prompt?.[Symbol.asyncIterator],
    "function",
  );
  const promptIterator = call.prompt[Symbol.asyncIterator]();
  assert.deepEqual(
    await promptIterator.next(),
    {
      done: false,
      value: {
        type: "user",
        uuid:
          "44444444-4444-4444-8444-444444444444",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [
            { type: "text", text: "hello" },
          ],
        },
      },
    },
  );
  assert.deepEqual(
    await promptIterator.next(),
    { done: true, value: undefined },
  );

  assert.equal(handle.completion, null);
  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-turn",
  );
  assert.deepEqual(
    result.normalizedEvents.map((event) => event.type),
    ["session", "text", "result"],
  );
});



test("turn handle forwards bidirectional query options without owning permission policy", async () => {
  let call;
  const canUseTool = async (_toolName, toolInput) => ({
    behavior: "allow",
    updatedInput: toolInput,
  });

  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    queryOptions: {
      allowedTools: ["Bash"],
      canUseTool,
    },
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages("provider-options")) {
            yield message;
          }
        },
      };
    },
  });

  assert.deepEqual(call.options.allowedTools, ["Bash"]);
  assert.equal(call.options.canUseTool, canUseTool);
  const result = await handle.start();
  assert.equal(result.providerSessionId, "provider-options");
});

test("turn handle enables SDK partial messages through the stable streaming option", async () => {
  let call;
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    streaming: true,
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id:
              "provider-streaming",
          };
          yield {
            type: "stream_event",
            session_id:
              "provider-streaming",
            event: {
              type:
                "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "hel",
              },
            },
          };
          yield {
            type: "stream_event",
            session_id:
              "provider-streaming",
            event: {
              type:
                "content_block_delta",
              index: 0,
              delta: {
                type: "text_delta",
                text: "lo",
              },
            },
          };
          yield {
            type: "result",
            subtype: "success",
            session_id:
              "provider-streaming",
            result: "hello",
          };
        },
      };
    },
  });

  assert.equal(
    call.options.includePartialMessages,
    true,
  );

  const partials = [];
  handle.events.on(
    "normalized-event",
    (event) => {
      if (event.type === "partial_text") {
        partials.push(event);
      }
    },
  );

  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-streaming",
  );
  assert.deepEqual(
    partials.map(
      (event) => event.payload.delta,
    ),
    ["hel", "lo"],
  );
  assert.equal(
    result.normalizedEvents
      .filter(
        (event) =>
          event.type === "partial_text",
      )
      .at(-1)
      ?.payload.accumulated_length,
    5,
  );
});

test("turn handle rejects a contradictory streaming option", async () => {
  await assert.rejects(
    createAgentSdkTurnHandle({
      prompt: "hello",
      environment: {},
      streaming: true,
      queryOptions: {
        includePartialMessages: false,
      },
      queryImpl: () => {
        throw new Error(
          "query should not start",
        );
      },
    }),
    /includePartialMessages: false/,
  );
});

test("turn handle wires the stable permission handler before explicit start", async () => {
  let call;
  const permissionRequests = [];
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    permissionHandler: async (request) => {
      permissionRequests.push(request);
      return {
        decision: "deny",
        message: "Denied for unit test.",
      };
    },
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages("provider-permission")) {
            yield message;
          }
        },
      };
    },
  });

  assert.equal(
    typeof call.options.canUseTool,
    "function",
  );

  const requestEvents = [];
  const decisionEvents = [];
  handle.events.on(
    "permission-request",
    (request) => {
      requestEvents.push(request);
    },
  );
  handle.events.on(
    "permission-decision",
    (payload) => {
      decisionEvents.push(payload);
    },
  );

  const sdkDecision =
    await call.options.canUseTool(
      "Bash",
      { command: "pwd" },
      {
        toolUseId: "toolu_handle",
        requestId: "req_handle",
      },
    );

  assert.deepEqual(sdkDecision, {
    behavior: "deny",
    message: "Denied for unit test.",
    interrupt: false,
  });
  assert.equal(permissionRequests.length, 1);
  assert.equal(requestEvents.length, 1);
  assert.equal(decisionEvents.length, 1);
  assert.equal(
    requestEvents[0].toolUseId,
    "toolu_handle",
  );

  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-permission",
  );
});

test("turn handle auto-allows exact Native Live attachment reads", async () => {
  let call;
  let permissionCalls = 0;
  const attachmentPath =
    "/tmp/leileios-native-live-inbox/c/p/a/photo.webp";

  const handle = await createAgentSdkTurnHandle({
    prompt: "look at my attachment",
    environment: {},
    trustedReadPaths: [attachmentPath],
    permissionHandler: async () => {
      permissionCalls += 1;
      throw new Error("attachment read must not prompt");
    },
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages("provider-attachment-read")) {
            yield message;
          }
        },
      };
    },
  });

  assert.deepEqual(
    await call.options.canUseTool(
      "Read",
      { file_path: attachmentPath },
      {
        toolUseID: "toolu_attachment_read",
      },
    ),
    { behavior: "allow" },
  );
  assert.equal(permissionCalls, 0);

  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-attachment-read",
  );
});

test("turn handle routes AskUserQuestion to questionHandler ahead of permissionHandler", async () => {
  let call;
  const questions = [];
  const permissions = [];

  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    questionHandler: async (request) => {
      questions.push(request);
      return {
        decision: "answer",
        answers: {
          [request.questions[0].question]:
            "Dark",
        },
      };
    },
    permissionHandler: async (request) => {
      permissions.push(request);
      return {
        decision: "deny",
        message: "Denied for unit test.",
      };
    },
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages("provider-question")) {
            yield message;
          }
        },
      };
    },
  });

  const sdkQuestionDecision =
    await call.options.canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which theme?",
            options: [],
            multiSelect: false,
          },
        ],
      },
      {
        toolUseID: "toolu_question",
        requestId: "req_question",
      },
    );

  assert.deepEqual(
    sdkQuestionDecision,
    {
      behavior: "allow",
      updatedInput: {
        questions: [
          {
            question: "Which theme?",
            options: [],
            multiSelect: false,
          },
        ],
        answers: {
          "Which theme?": "Dark",
        },
      },
    },
  );
  assert.equal(questions.length, 1);
  assert.equal(permissions.length, 0);

  const sdkPermissionDecision =
    await call.options.canUseTool(
      "Write",
      {
        file_path: "/tmp/x",
        content: "x",
      },
      {
        toolUseID: "toolu_write",
      },
    );

  assert.equal(
    sdkPermissionDecision.behavior,
    "deny",
  );
  assert.equal(permissions.length, 1);

  const result = await handle.start();
  assert.equal(
    result.providerSessionId,
    "provider-question",
  );
});

test("question-only turn handles fail closed for unrelated permission prompts", async () => {
  let call;
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    questionHandler: async (request) => ({
      decision: "answer",
      answers: {
        [request.questions[0].question]:
          "Dark",
      },
    }),
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          for (const message of successMessages("provider-question-only")) {
            yield message;
          }
        },
      };
    },
  });

  assert.deepEqual(
    await call.options.canUseTool(
      "Bash",
      { command: "pwd" },
      {
        toolUseID: "toolu_unrelated",
      },
    ),
    {
      behavior: "deny",
      message:
        "LeileiOS has no permission handler configured for this tool request.",
      interrupt: false,
    },
  );

  await handle.start();
});

test("question handler rejects callback-shadowing SDK options", async () => {
  await assert.rejects(
    createAgentSdkTurnHandle({
      prompt: "hello",
      environment: {},
      questionHandler: async () => ({
        decision: "cancel",
        message: "cancelled",
      }),
      queryOptions: {
        allowedTools: [
          "AskUserQuestion",
        ],
      },
      queryImpl: () => {
        throw new Error(
          "query should not start",
        );
      },
    }),
    /allowedTools/,
  );
});

test("turn handle rejects permission options that can shadow the callback", async () => {
  await assert.rejects(
    createAgentSdkTurnHandle({
      prompt: "hello",
      environment: {},
      permissionHandler: async () => ({
        decision: "allow",
      }),
      queryOptions: {
        allowedTools: ["Bash"],
      },
      queryImpl: () => {
        throw new Error(
          "query should not start",
        );
      },
    }),
    /allowedTools/,
  );
});

test("turn handle emits nothing before explicit start", async () => {
  let iteratorStarted = false;
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    queryImpl: () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        iteratorStarted = true;
        for (const message of successMessages("provider-explicit-start")) {
          yield message;
        }
      },
    }),
  });

  const emitted = [];
  handle.events.on("normalized-event", (event) => {
    emitted.push(event);
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(iteratorStarted, false);
  assert.deepEqual(emitted, []);

  const result = await handle.start();
  assert.equal(iteratorStarted, true);
  assert.equal(
    result.providerSessionId,
    "provider-explicit-start",
  );
  assert.equal(emitted.length, 3);
});

test("turn handle can queue a second user message while the SDK turn is active", async () => {
  let firstConsumed;
  const firstConsumedGate =
    new Promise((resolve) => {
      firstConsumed = resolve;
    });

  const observed = [];
  let call;

  const handle = await createAgentSdkTurnHandle({
    prompt: "initial instruction",
    environment: {},
    midTurnInput: true,
    userMessageUuid:
      "44444444-4444-4444-8444-444444444444",
    queryImpl: (input) => {
      call = input;
      return {
        close() {},
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id:
              "provider-mid-turn",
          };

          const iterator =
            call.prompt[
              Symbol.asyncIterator
            ]();

          const first =
            await iterator.next();
          observed.push({
            text:
              first.value.message.content[0]
                .text,
            uuid: first.value.uuid,
          });
          firstConsumed();

          const second =
            await iterator.next();
          observed.push({
            text:
              second.value.message.content[0]
                .text,
            uuid: second.value.uuid,
          });

          yield {
            type: "result",
            subtype: "success",
            session_id:
              "provider-mid-turn",
            result:
              second.value.message
                .content[0].text,
          };
        },
      };
    },
  });

  assert.throws(
    () =>
      handle.sendUserMessage(
        "too early",
      ),
    /has not started/,
  );

  const completion = handle.start();
  await firstConsumedGate;

  assert.deepEqual(
    handle.sendUserMessage(
      "updated instruction",
      {
        uuid:
          "55555555-5555-4555-8555-555555555555",
      },
    ),
    {
      status: "queued",
      command_uuid:
        "55555555-5555-4555-8555-555555555555",
    },
  );

  const result = await completion;
  assert.deepEqual(observed, [
    {
      text: "initial instruction",
      uuid:
        "44444444-4444-4444-8444-444444444444",
    },
    {
      text: "updated instruction",
      uuid:
        "55555555-5555-4555-8555-555555555555",
    },
  ]);
  assert.equal(
    result.result.result,
    "updated instruction",
  );

  assert.throws(
    () =>
      handle.sendUserMessage(
        "too late",
      ),
    /no longer accepts user input/,
  );
});

test("turn handle rejects mid-turn input when the capability is disabled", async () => {
  const handle = await createAgentSdkTurnHandle({
    prompt: "hello",
    environment: {},
    queryImpl: () => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        for (const message of successMessages("provider-no-mid-turn")) {
          yield message;
        }
      },
    }),
  });

  const completion = handle.start();
  assert.throws(
    () =>
      handle.sendUserMessage(
        "not enabled",
      ),
    /does not have mid-turn input enabled/,
  );
  await completion;
});

test("turn handle maps a successful graceful interrupt to INTERRUPTED", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const startedGate = new Promise((resolve) => {
    started = resolve;
  });

  const handle = await createAgentSdkTurnHandle({
    prompt: "long task",
    environment: {},
    queryImpl: () => ({
      close() {},
      async interrupt() {
        release();
        return { still_queued: [] };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-interrupt",
        };
        started();
        await gate;
        yield {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          session_id: "provider-interrupt",
          errors: ["interrupt diagnostic"],
        };
        throw new Error(
          "Claude Code returned an error result: interrupt diagnostic",
        );
      },
    }),
  });

  const completion = handle.start();
  await startedGate;
  const receipt = await handle.interrupt();
  assert.deepEqual(receipt, { still_queued: [] });

  await assert.rejects(
    completion,
    (error) =>
      error.runtimeCode === "INTERRUPTED"
      && error.providerSessionId === "provider-interrupt"
      && error.interruptReceipt?.still_queued?.length === 0,
  );
});

test("turn handle interrupt cannot hang when the SDK iterator stays open", async () => {
  let started;
  const startedGate = new Promise((resolve) => {
    started = resolve;
  });
  let closeCalls = 0;

  const handle = await createAgentSdkTurnHandle({
    prompt: "long task",
    environment: {},
    queryImpl: () => ({
      close() {
        closeCalls += 1;
      },
      async interrupt() {
        return { still_queued: [] };
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-interrupt-hang",
        };
        started();
        await new Promise(() => {});
      },
    }),
  });

  const completion = handle.start();
  await startedGate;
  const receipt = await handle.interrupt();
  assert.deepEqual(receipt, { still_queued: [] });

  await assert.rejects(
    completion,
    (error) =>
      error.runtimeCode === "INTERRUPTED"
      && error.providerSessionId === "provider-interrupt-hang",
  );
  assert.equal(closeCalls, 1);
});

test("turn handle hard abort remains separate from graceful interrupt", async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const startedGate = new Promise((resolve) => {
    started = resolve;
  });

  const handle = await createAgentSdkTurnHandle({
    prompt: "long task",
    environment: {},
    queryImpl: () => ({
      close() {
        release();
      },
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "provider-abort",
        };
        started();
        await gate;
      },
    }),
  });

  const completion = handle.start();
  await startedGate;
  handle.abort();

  await assert.rejects(
    completion,
    (error) => error.runtimeCode === "ABORTED",
  );
});


test("turn startup reconnects LeileiOS MCP before releasing the first prompt", async () => {
  let reconnectCalls = 0;
  let connected = false;
  const handle = await createAgentSdkTurnHandle({
    prompt: "use LeileiOS",
    environment: {},
    queryOptions: {
      mcpServers: {
        leileios: {
          type: "http",
          url: "https://leilei-os.example/internal/native-live-mcp",
          headers: {
            Authorization: "Bearer relay-secret",
          },
        },
      },
    },
    queryImpl: () => ({
      close() {},
      async mcpServerStatus() {
        return [{
          name: "leileios",
          status: connected ? "connected" : "failed",
          ...(connected ? {} : { error: "deployment restarted" }),
        }];
      },
      async reconnectMcpServer(name) {
        assert.equal(name, "leileios");
        reconnectCalls += 1;
        connected = true;
      },
      async *[Symbol.asyncIterator]() {
        for (const message of successMessages("provider-mcp-ready")) {
          yield message;
        }
      },
    }),
  });

  assert.equal(reconnectCalls, 1);
  const result = await handle.start();
  assert.equal(result.providerSessionId, "provider-mcp-ready");
});


test("turn startup keeps reconnecting a cold LeileiOS MCP without recreating the query or prompt", async () => {
  let queryCalls = 0;
  let reconnectCalls = 0;
  let mcpReady = false;
  let promptsBeforeReady = 0;
  const promptMessages = [];

  const handle = await createAgentSdkTurnHandle({
    prompt: "cold start message",
    environment: {},
    streaming: true,
    mcpStartupTimeoutMs: 2_000,
    queryOptions: {
      mcpServers: {
        leileios: {
          type: "http",
          url: "https://leilei-os.example/internal/native-live-mcp",
          headers: {
            Authorization: "Bearer relay-secret",
          },
        },
      },
    },
    queryImpl: ({ prompt }) => {
      queryCalls += 1;
      // The real SDK starts consuming input inside query(), not handle.start().
      const inputConsumed = (async () => {
        for await (const message of prompt) {
          promptMessages.push(message);
          if (!mcpReady) promptsBeforeReady += 1;
        }
      })();
      return {
        close() {},
        async mcpServerStatus() {
          mcpReady = reconnectCalls >= 3;
          return [{
            name: "leileios",
            status: reconnectCalls >= 3 ? "connected" : "failed",
            ...(reconnectCalls >= 3
              ? {}
              : { error: "database is still waking" }),
          }];
        },
        async reconnectMcpServer(name) {
          assert.equal(name, "leileios");
          reconnectCalls += 1;
          if (reconnectCalls < 3) {
            throw new Error("database is still waking");
          }
        },
        async *[Symbol.asyncIterator]() {
          await inputConsumed;
          for (const message of successMessages("provider-mcp-cold-start")) {
            yield message;
          }
        },
      };
    },
  });

  assert.equal(queryCalls, 1);
  assert.equal(reconnectCalls, 3);
  assert.equal(promptsBeforeReady, 0);

  const result = await handle.start();
  assert.equal(result.providerSessionId, "provider-mcp-cold-start");
  assert.equal(queryCalls, 1);
  assert.equal(promptMessages.length, 1);
  assert.equal(
    promptMessages[0]?.message?.content?.[0]?.text,
    "cold start message",
  );
});


test("turn startup closes a query that misses the LeileiOS MCP startup budget", async () => {
  let closeCalls = 0;
  await assert.rejects(
    () => createAgentSdkTurnHandle({
      prompt: "wait for LeileiOS",
      environment: {},
      mcpStartupTimeoutMs: 5,
      queryOptions: {
        mcpServers: {
          leileios: {
            type: "http",
            url: "https://leilei-os.example/internal/native-live-mcp",
            headers: {
              Authorization: "Bearer relay-secret",
            },
          },
        },
      },
      queryImpl: () => ({
        close() {
          closeCalls += 1;
        },
        async mcpServerStatus() {
          return [{
            name: "leileios",
            status: "connecting",
          }];
        },
        async *[Symbol.asyncIterator]() {
          throw new Error("turn must not start before MCP readiness");
        },
      }),
    }),
    /LeileiOS MCP did not connect before the Claude turn started/u,
  );
  assert.equal(closeCalls, 1);
});


test("MCP readiness gates eager prompt reads for normal, queued and string-prompt modes", async (t) => {
  for (const [name, modeOptions] of [
    ["normal", {}],
    ["mid-turn queue", { midTurnInput: true }],
    ["string-prompt compatibility", { verbatimPrompts: false }],
  ]) {
    await t.test(name, async () => {
      let connected = false;
      let reconnects = 0;
      let queryCalls = 0;
      const beforeReady = [];
      const delivered = [];
      const handle = await createAgentSdkTurnHandle({
        prompt: "exactly once",
        environment: {},
        mcpStartupTimeoutMs: 2_000,
        midTurnInput: modeOptions.midTurnInput ?? false,
        queryOptions: {
          ...("verbatimPrompts" in modeOptions
            ? { verbatimPrompts: modeOptions.verbatimPrompts }
            : {}),
          mcpServers: { leileios: { type: "http", url: "https://example.invalid/mcp" } },
        },
        queryImpl: ({ prompt }) => {
          queryCalls += 1;
          const firstRead = typeof prompt === "string"
            ? Promise.resolve({ value: prompt, done: false })
            : prompt[Symbol.asyncIterator]().next();
          const consumed = firstRead.then(({ value, done }) => {
            if (!done) {
              delivered.push(value);
              if (!connected) beforeReady.push(value);
            }
          });
          return {
            close() {},
            async mcpServerStatus() {
              connected = reconnects >= 2;
              return [{ name: "leileios", status: connected ? "connected" : "failed" }];
            },
            async reconnectMcpServer() {
              reconnects += 1;
              if (reconnects < 2) throw new Error("database waking");
            },
            async *[Symbol.asyncIterator]() {
              await consumed;
              yield* successMessages();
            },
          };
        },
      });
      await handle.start();
      assert.equal(queryCalls, 1);
      assert.equal(reconnects, 2);
      assert.deepEqual(beforeReady, []);
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].message.content[0].text, "exactly once");
    });
  }
});

test("MCP startup timeout ends the eager input stream before closing the query without sending", async () => {
  let closeCalls = 0;
  let firstRead;
  const delivered = [];
  await assert.rejects(createAgentSdkTurnHandle({
    prompt: "must not send",
    environment: {},
    midTurnInput: true,
    mcpStartupTimeoutMs: 25,
    queryOptions: { mcpServers: { leileios: { type: "http", url: "https://example.invalid/mcp" } } },
    queryImpl: ({ prompt }) => {
      firstRead = prompt[Symbol.asyncIterator]().next().then((item) => {
        if (!item.done) delivered.push(item.value);
        return item;
      });
      return {
        async close() { closeCalls += 1; await firstRead; },
        async mcpServerStatus() { return [{ name: "leileios", status: "failed" }]; },
        async reconnectMcpServer() { throw new Error("still asleep"); },
        async *[Symbol.asyncIterator]() { throw new Error("must not start"); },
      };
    },
  }), /LeileiOS MCP did not connect/);
  assert.equal(closeCalls, 1);
  assert.deepEqual(delivered, []);
  assert.equal((await firstRead).done, true);
});

test("query construction failure releases a pending gated input reader without sending", async () => {
  let firstRead;
  await assert.rejects(createAgentSdkTurnHandle({
    prompt: "must not send",
    environment: {},
    queryOptions: { mcpServers: { leileios: { type: "http", url: "https://example.invalid/mcp" } } },
    queryImpl: ({ prompt }) => {
      firstRead = prompt[Symbol.asyncIterator]().next();
      throw new Error("query construction failed");
    },
  }), /query construction failed/);
  assert.equal((await firstRead).done, true);
});

test("installed Agent SDK cannot write a native command before MCP readiness", async (t) => {
  // Railway's server-only gate does not install the Mac-only SDK dependency.
  let sdkPath;
  try {
    sdkPath = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    t.skip("Actual SDK integration requires installed Mac bridge dependencies.");
    return;
  }
  const { query } = await import(sdkPath);
  const { PassThrough } = await import("node:stream");
  const { EventEmitter } = await import("node:events");
  let spawns = 0;
  let reconnects = 0;
  let ready = false;
  const sent = [];
  const beforeReady = [];
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
    child.stdout.end();
    child.stderr.end();
    return true;
  };
  let buffer = "";
  child.stdin.on("data", (data) => {
    buffer += data.toString();
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.type === "control_request") {
        const subtype = message.request.subtype;
        let response = {};
        let error = null;
        if (subtype === "mcp_status") {
          ready = reconnects >= 3;
          response = { mcpServers: [{ name: "leileios", status: ready ? "connected" : "failed" }] };
        } else if (subtype === "mcp_reconnect") {
          reconnects += 1;
          if (reconnects < 3) error = "database waking";
        }
        child.stdout.write(JSON.stringify({
          type: "control_response",
          response: error
            ? { subtype: "error", request_id: message.request_id, error }
            : { subtype: "success", request_id: message.request_id, response },
        }) + "\n");
      } else if (message.type === "user") {
        sent.push(message);
        if (!ready) beforeReady.push(message);
        for (const event of successMessages("provider-real-sdk")) {
          child.stdout.write(JSON.stringify(event) + "\n");
        }
        queueMicrotask(() => {
          child.exitCode = 0;
          child.stdout.end();
          child.stderr.end();
          child.emit("exit", 0, null);
        });
      }
    }
  });
  const handle = await createAgentSdkTurnHandle({
    prompt: "/schedule list",
    environment: {},
    mcpStartupTimeoutMs: 3_000,
    queryImpl: query,
    queryOptions: {
      verbatimPrompts: false,
      mcpServers: { leileios: { type: "http", url: "https://example.invalid/mcp" } },
      spawnClaudeCodeProcess: () => { spawns += 1; return child; },
    },
  });
  const result = await handle.start();
  assert.equal(result.providerSessionId, "provider-real-sdk");
  assert.equal(spawns, 1);
  assert.equal(reconnects, 3);
  assert.deepEqual(beforeReady, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.content[0].text, "/schedule list");
  assert.equal(sent[0].client_composed, undefined);
});
