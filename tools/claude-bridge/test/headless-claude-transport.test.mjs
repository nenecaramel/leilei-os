import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { HeadlessClaudeTransport } from "../src/headless-claude-transport.mjs";

function fakeChild({ stdout = [], stderr = [], code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  queueMicrotask(() => {
    for (const line of stdout) child.stdout.emit("data", Buffer.from(line));
    for (const line of stderr) child.stderr.emit("data", Buffer.from(line));
    child.emit("close", code, null);
  });
  return child;
}

test("sendNew uses print stream-json and reads a provider session id from a structured event", async () => {
  let call;
  const transport = new HeadlessClaudeTransport({
    spawn: (command, args) => { call = { command, args }; return fakeChild({ stdout: [JSON.stringify({ type: "system", subtype: "init", session_id: "provider-real-1" }) + "\n", JSON.stringify({ type: "result", result: "READY" }) + "\n"] }); },
    environment: {},
  });
  const events = [];
  transport.events.on("event", (event) => events.push(event.type));
  const result = await transport.sendNew("remember this");
  assert.deepEqual(call, { command: "claude", args: ["-p", "remember this", "--output-format=stream-json", "--verbose"] });
  assert.equal(result.providerSessionId, "provider-real-1");
  assert.deepEqual(events, ["system", "result"]);
});

test("resume passes the real provider session id and preserves structured output", async () => {
  let args;
  const transport = new HeadlessClaudeTransport({ spawn: (_command, nextArgs) => { args = nextArgs; return fakeChild({ stdout: [JSON.stringify({ type: "system", session_id: "provider-real-1" }) + "\n"] }); }, environment: {} });
  await transport.resume("provider-real-1", "what was it?");
  assert.deepEqual(args, ["-p", "what was it?", "--resume", "provider-real-1", "--output-format=stream-json", "--verbose"]);
});

test("fork resumes with --fork-session and rejects a provider session id reused from its parent", async () => {
  let args;
  const transport = new HeadlessClaudeTransport({ spawn: (_command, nextArgs) => { args = nextArgs; return fakeChild({ stdout: [JSON.stringify({ type: "system", session_id: "provider-fork" }) + "\n"] }); }, environment: {} });
  const result = await transport.fork("provider-root", "branch prompt");
  assert.deepEqual(args, ["-p", "branch prompt", "--resume", "provider-root", "--fork-session", "--output-format=stream-json", "--verbose"]);
  assert.equal(result.providerSessionId, "provider-fork");
  const sameId = new HeadlessClaudeTransport({ spawn: () => fakeChild({ stdout: [JSON.stringify({ type: "system", session_id: "provider-root" }) + "\n"] }), environment: {} });
  await assert.rejects(() => sameId.fork("provider-root", "branch prompt"), (error) => error.runtimeCode === "PROVIDER_SESSION_CONFLICT" && /same provider session id/i.test(error.message));
});

test("a malformed stream event is observable and rejects the request", async () => {
  const transport = new HeadlessClaudeTransport({ spawn: () => fakeChild({ stdout: ["not-json\n"] }), environment: {} });
  const errors = [];
  transport.events.on("parse-error", (error) => errors.push(error.message));
  await assert.rejects(() => transport.sendNew("hello"), (error) => error.runtimeCode === "MALFORMED_STREAM" && /malformed JSON/i.test(error.message));
  assert.equal(errors.length, 1);
});

test("a non-zero Claude exit returns observable stderr", async () => {
  const transport = new HeadlessClaudeTransport({ spawn: () => fakeChild({ stderr: ["not logged in\n"], code: 1 }), environment: {} });
  await assert.rejects(() => transport.sendNew("hello"), (error) => error.runtimeCode === "CLAUDE_PROCESS_FAILED" && /exit code 1: not logged in/i.test(error.message));
});

test("refuses to run when ANTHROPIC_API_KEY is present", () => {
  assert.throws(() => new HeadlessClaudeTransport({ environment: { ANTHROPIC_API_KEY: "forbidden" } }), /ANTHROPIC_API_KEY/);
});


test("emits normalized events before exit and returns the same event objects", async () => {
  const transport = new HeadlessClaudeTransport({
    spawn: () => fakeChild({
      stdout: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "provider-stream-1" }) + "\n",
        JSON.stringify({ type: "assistant", session_id: "provider-stream-1", delta: { text: "hel" } }) + "\n",
        JSON.stringify({ type: "result", session_id: "provider-stream-1", result: "hello" }) + "\n",
      ],
    }),
    environment: {},
  });

  const order = [];
  const emitted = [];
  transport.events.on("normalized-event", (event) => {
    order.push(`normalized:${event.type}`);
    emitted.push(event);
  });
  transport.events.on("exit", () => order.push("exit"));

  const result = await transport.sendNew("hello");

  assert.deepEqual(order, [
    "normalized:session",
    "normalized:partial_text",
    "normalized:result",
    "exit",
  ]);
  assert.deepEqual(result.normalizedEvents, emitted);
  assert.deepEqual(result.normalizedEvents.map((event) => event.sequence), [1, 2, 3]);
});
