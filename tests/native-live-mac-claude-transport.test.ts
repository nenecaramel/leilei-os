import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createNativeLiveMacClaudeTransport,
  resolveNativeLiveMacClaudeTransportKind,
  sanitizeNativeLiveClaudeEnvironment,
} from "../src/domains/bridge/mac/native-live-mac-claude-transport.js";

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

test("Mac daemon transport requires an explicit absolute working directory", async () => {
  await assert.rejects(
    createNativeLiveMacClaudeTransport({}),
    /explicit absolute working directory/u,
  );
  await assert.rejects(
    createNativeLiveMacClaudeTransport({}, "./relative"),
    /explicit absolute working directory/u,
  );
});

test("Mac daemon transport factory creates the Agent SDK adapter at the configured working directory", async () => {
  const workingDirectory = process.cwd();
  const agent = await createNativeLiveMacClaudeTransport(
    {},
    workingDirectory,
  );
  assert.equal(agent.kind, "agent_sdk");
  assert.equal(typeof agent.runtime.sendNew, "function");
  assert.equal(typeof agent.runtime.resume, "function");
  assert.equal(typeof agent.runtime.fork, "function");
  assert.equal(typeof agent.runtime.abort, "function");
  assert.equal(typeof agent.runtime.executeTurn, "function");
  assert.equal(
    (agent.runtime as unknown as { cwd: string }).cwd,
    workingDirectory,
  );
});

test("Mac daemon strips LeileiOS credentials from Claude Code environment", () => {
  assert.deepEqual(
    sanitizeNativeLiveClaudeEnvironment({
      HOME: "/Users/leilei",
      LEILEI_NATIVE_LIVE_RELAY_TOKEN: "relay-secret",
      NATIVE_LIVE_RELAY_AUTH_TOKEN: "railway-relay-secret",
      MCP_AUTH_TOKEN: "broad-mcp-secret",
      LEILEI_MEME_GITHUB_TOKEN: "retired-secret",
      LEILEI_MEME_GH_PATH: "/old/gh",
      SAFE_FLAG: "visible",
    }),
    {
      HOME: "/Users/leilei",
      SAFE_FLAG: "visible",
    },
  );
});

test("Mac daemon transport carries MCP config outside the Claude environment", async () => {
  const workingDirectory = process.cwd();
  const agent = await createNativeLiveMacClaudeTransport(
    {
      HOME: "/Users/leilei",
      LEILEI_NATIVE_LIVE_RELAY_TOKEN: "must-not-reach-bash",
    },
    workingDirectory,
    null,
    {
      type: "http",
      url: "https://leilei-os.example/internal/native-live-mcp",
      headers: {
        Authorization: "Bearer relay-secret",
      },
    },
  );
  const runtime = agent.runtime as unknown as {
    environment: Record<string, string | undefined>;
    mcpServerConfig: {
      type: string;
      url: string;
      headers: Record<string, string>;
    };
  };
  assert.equal(
    runtime.environment.LEILEI_NATIVE_LIVE_RELAY_TOKEN,
    undefined,
  );
  assert.deepEqual(runtime.mcpServerConfig, {
    type: "http",
    url: "https://leilei-os.example/internal/native-live-mcp",
    headers: {
      Authorization: "Bearer relay-secret",
    },
  });
});

test("Agent SDK turns send no custom prompt and no Claude Code preset", () => {
  // Declaration contract only; transport tests exercise the actual query options.
  const transport = readFileSync("tools/claude-bridge/src/agent-sdk-transport-support.mjs", "utf8");
  assert.doesNotMatch(transport, /SYSTEM_PROMPT/u);
  const turnHandle = readFileSync("tools/claude-bridge/src/agent-sdk-turn-handle.mjs", "utf8");
  assert.doesNotMatch(turnHandle, /preset: "claude_code"/u);
});

test("the real Mac transport factory auto-approves tools but still routes user questions", async () => {
  const { runtime } = await createNativeLiveMacClaudeTransport({}, process.cwd());
  let questions = 0;
  const fixture = runtime as unknown as {
    queryImpl: (input: { options: { canUseTool: (name: string, input: Record<string, unknown>) => Promise<{
      behavior: string; updatedInput?: { answers: Record<string, string> };
    }> } }) => unknown;
  };
  fixture.queryImpl = ({ options }) => ({
    close() {},
    async *[Symbol.asyncIterator]() {
      assert.deepEqual(await options.canUseTool("Write", { file_path: "/synthetic", content: "fixture" }), { behavior: "allow" });
      const answer = await options.canUseTool("AskUserQuestion", { questions: [{ question: "Synthetic choice?", options: [] }] });
      assert.equal(answer.updatedInput?.answers["Synthetic choice?"], "Chosen");
      yield { type: "system", subtype: "init", session_id: "factory-permission-fixture" };
      yield { type: "result", subtype: "success", session_id: "factory-permission-fixture", result: "fixture" };
    },
  });
  assert.ok(runtime.executeTurn);
  await runtime.executeTurn("synthetic", {
    mode: "new", parentProviderSessionId: null, streaming: true,
    permissionHandler: async () => assert.fail("must not create a permission interaction"),
    questionHandler: async () => { questions++; return { decision: "answer", answers: { "Synthetic choice?": "Chosen" } }; },
  });
  assert.equal(questions, 1);
});

test('real Mac factory exposes an explicitly admitted persistent session without forking',async()=>{
 const {runtime}=await createNativeLiveMacClaudeTransport({},process.cwd());let calls=0;
 (runtime as unknown as {queryImpl:(input:{prompt:AsyncIterable<{uuid:string}>;options:Record<string,unknown>})=>unknown}).queryImpl=({prompt,options})=>{
  calls++;assert.equal(options.resume,undefined);assert.equal(options.forkSession,undefined);
  return {close(){},async *[Symbol.asyncIterator](){let initialized=false;for await(const input of prompt){if(!initialized){initialized=true;yield {type:'system',subtype:'init',session_id:'factory-persistent'};}yield {type:'result',subtype:'success',session_id:'factory-persistent',user_message_uuid:input.uuid,result:'synthetic'};}}};
 };
 assert.ok(runtime.openPersistentSession);const session=await runtime.openPersistentSession({authorize:async()=>true,onBackgroundResult:async()=>{}});
 try {assert.equal((await session.submit('first',{source:'human'})).providerSessionId,'factory-persistent');assert.equal((await session.submit('wake',{source:'task-notification'})).providerSessionId,'factory-persistent');assert.equal(calls,1);}finally{await session.close();}
});
