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
          observed.push(
            first.value.message.content[0]
              .text,
          );
          firstConsumed();

          const second =
            await iterator.next();
          observed.push(
            second.value.message.content[0]
              .text,
          );

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
    ),
    { status: "queued" },
  );

  const result = await completion;
  assert.deepEqual(observed, [
    "initial instruction",
    "updated instruction",
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
