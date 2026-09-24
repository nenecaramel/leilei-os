import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeLiveMacClaudeTransport,
  resolveNativeLiveMacClaudeTransportKind,
} from "../src/domains/bridge/native-live-mac-claude-transport.js";

test("Mac daemon Claude transport defaults to Agent SDK", () => {
  assert.equal(
    resolveNativeLiveMacClaudeTransportKind({}),
    "agent_sdk",
  );
});

test("Mac daemon Claude transport keeps explicit headless rollback", () => {
  assert.equal(
    resolveNativeLiveMacClaudeTransportKind({
      LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: " headless ",
    }),
    "headless",
  );
});

test("Mac daemon Claude transport rejects unknown selector values", () => {
  assert.throws(
    () =>
      resolveNativeLiveMacClaudeTransportKind({
        LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: "other",
      }),
    /must be agent_sdk or headless/i,
  );
});

test("Mac daemon transport factory creates the selected parity adapter", async () => {
  const agent = await createNativeLiveMacClaudeTransport(
    {},
    process.cwd(),
  );
  assert.equal(agent.kind, "agent_sdk");
  assert.equal(typeof agent.runtime.sendNew, "function");
  assert.equal(typeof agent.runtime.resume, "function");
  assert.equal(typeof agent.runtime.fork, "function");
  assert.equal(typeof agent.runtime.abort, "function");

  const headless = await createNativeLiveMacClaudeTransport(
    {
      LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: "headless",
    },
    process.cwd(),
  );
  assert.equal(headless.kind, "headless");
  assert.equal(typeof headless.runtime.sendNew, "function");
  assert.equal(typeof headless.runtime.resume, "function");
  assert.equal(typeof headless.runtime.fork, "function");
  assert.equal(typeof headless.runtime.abort, "function");
});
