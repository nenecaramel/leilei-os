import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacProviderSessionStore,
} from "../src/domains/bridge/native-live-mac-provider-session-store.js";

const workspaceId = "55555555-5555-4555-8555-555555555555";

test("Mac SessionStore maps the Agent SDK contract onto one durable Workspace", async () => {
  const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
  const responses = [
    { success: true, data: null },
    { success: true, data: { entries: [{ type: "user", n: 1 }] } },
    { success: true, data: { sessions: [{ sessionId: "s1", mtime: 1790590000000 }] } },
    { success: true, data: { subkeys: ["subagents/a"] } },
    { success: true, data: null },
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: headers.get("authorization"),
    });
    const payload = responses.shift();
    if (!payload) throw new Error("unexpected fetch");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example/",
    "secret-token",
    workspaceId,
    fakeFetch,
  );
  const key = {
    projectKey: "/Users/leilei/Projects/demo",
    sessionId: "s1",
  };

  await store.append(key, [{ type: "user", n: 1 }]);
  assert.deepEqual(await store.load(key), [{ type: "user", n: 1 }]);
  assert.deepEqual(await store.listSessions("ignored-local-project-key"), [
    { sessionId: "s1", mtime: 1790590000000 },
  ]);
  assert.deepEqual(await store.listSubkeys(key), ["subagents/a"]);
  await store.delete(key);

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://relay.example/internal/native-live-session-store/append",
      "https://relay.example/internal/native-live-session-store/load",
      "https://relay.example/internal/native-live-session-store/list-sessions",
      "https://relay.example/internal/native-live-session-store/list-subkeys",
      "https://relay.example/internal/native-live-session-store/delete",
    ],
  );
  for (const call of calls) {
    assert.equal(call.auth, "Bearer secret-token");
  }
  assert.deepEqual(calls[0]?.body, {
    key: {
      workspace_id: workspaceId,
      session_id: "s1",
    },
    entries: [{ type: "user", n: 1 }],
  });
  assert.equal(
    JSON.stringify(calls).includes("/Users/leilei/Projects/demo"),
    false,
  );
});

test("Mac SessionStore preserves subpath identity and null load semantics", async () => {
  const bodies: unknown[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return new Response(JSON.stringify({
      success: true,
      data: { entries: null },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example",
    "secret-token",
    workspaceId,
    fakeFetch,
  );
  assert.equal(
    await store.load({
      projectKey: "anything",
      sessionId: "s1",
      subpath: "subagents/x",
    }),
    null,
  );
  assert.deepEqual(bodies, [{
    key: {
      workspace_id: workspaceId,
      session_id: "s1",
      subpath: "subagents/x",
    },
  }]);
});
