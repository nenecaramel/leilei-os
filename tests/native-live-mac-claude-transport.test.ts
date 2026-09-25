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

test("Mac daemon Claude transport accepts explicit agent_sdk", () => {
  assert.equal(
    resolveNativeLiveMacClaudeTransportKind({
      LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: " agent_sdk ",
    }),
    "agent_sdk",
  );
});

test("Mac daemon Claude transport rejects retired selectors", () => {
  assert.throws(
    () =>
      resolveNativeLiveMacClaudeTransportKind({
        LEILEI_NATIVE_LIVE_CLAUDE_TRANSPORT: "headless",
      }),
    /retired.*agent_sdk only/i,
  );
});

test("Mac daemon transport factory creates the Agent SDK adapter", async () => {
  const agent = await createNativeLiveMacClaudeTransport(
    {},
    process.cwd(),
  );
  assert.equal(agent.kind, "agent_sdk");
  assert.equal(typeof agent.runtime.sendNew, "function");
  assert.equal(typeof agent.runtime.resume, "function");
  assert.equal(typeof agent.runtime.fork, "function");
  assert.equal(typeof agent.runtime.abort, "function");
  assert.equal(typeof agent.runtime.executeTurn, "function");
});
