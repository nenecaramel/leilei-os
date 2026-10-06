import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacProviderSessionStore,
} from "../src/domains/bridge/mac/native-live-mac-provider-session-store.js";

test("Mac SessionStore maps the Agent SDK contract onto a user-scoped provider session", async () => {
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
  const appendBody = calls[0]?.body as {
    key: unknown;
    append_batch_id: string;
    entries: unknown;
  };
  assert.deepEqual(appendBody.key, {
    session_id: "s1",
  });
  assert.match(
    appendBody.append_batch_id,
    /^[0-9a-f-]{36}$/u,
  );
  assert.deepEqual(appendBody.entries, [{ type: "user", n: 1 }]);
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
      session_id: "s1",
      subpath: "subagents/x",
    },
  }]);
});

test("Mac SessionStore reuses one append batch id after ambiguous delivery", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let attempt = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    attempt += 1;
    if (attempt === 1) {
      throw new Error("response lost after commit");
    }
    return new Response(JSON.stringify({
      success: true,
      data: null,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const key = { projectKey: "/local/path", sessionId: "s1" };
  const entries = [{ type: "assistant", text: "same batch" }];

  await assert.rejects(
    () => store.append(key, entries),
    /response lost after commit/u,
  );
  await store.append(key, entries);

  assert.equal(bodies.length, 2);
  assert.equal(
    bodies[0]?.append_batch_id,
    bodies[1]?.append_batch_id,
    "retry must reuse the exact append batch receipt",
  );
});

test("Mac SessionStore chunks large appends and reuses every chunk receipt after partial delivery", async () => {
  const calls: Array<{
    batchId: string;
    entryLengths: number[];
  }> = [];
  let attempt = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      append_batch_id: string;
      entries: Array<{ text?: string }>;
    };
    calls.push({
      batchId: body.append_batch_id,
      entryLengths: body.entries.map(
        (entry) => entry.text?.length ?? 0,
      ),
    });
    attempt += 1;
    if (attempt === 2) {
      throw new Error("second chunk response lost after commit");
    }
    return new Response(JSON.stringify({
      success: true,
      data: null,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const key = { projectKey: "/local/path", sessionId: "s-large" };
  const entries = [
    { type: "assistant", text: "a".repeat(3_100_000) },
    { type: "assistant", text: "b".repeat(3_100_000) },
  ];

  await assert.rejects(
    () => store.append(key, entries),
    /second chunk response lost after commit/u,
  );
  await store.append(key, entries);

  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((call) => call.entryLengths),
    [
      [3_100_000],
      [3_100_000],
      [3_100_000],
      [3_100_000],
    ],
  );
  assert.equal(calls[0]?.batchId, calls[2]?.batchId);
  assert.equal(calls[1]?.batchId, calls[3]?.batchId);
  assert.notEqual(calls[0]?.batchId, calls[1]?.batchId);
});

test("Mac SessionStore keeps one receipt until mirror_error discards it", async () => {
  const ids: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      append_batch_id: string;
    };
    ids.push(body.append_batch_id);
    throw new Error("store unavailable");
  };
  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );
  const key = { projectKey: "/local/path", sessionId: "s1" };
  const entries = [{ type: "assistant", text: "retry chain" }];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      () => store.append(key, entries),
      /store unavailable/u,
    );
  }
  assert.equal(new Set(ids).size, 1);

  store.discardPendingAppends("s1");
  await assert.rejects(
    () => store.append(key, entries),
    /store unavailable/u,
  );
  assert.notEqual(
    ids.at(-1),
    ids[0],
    "mirror_error must terminate the prior retry receipt",
  );
});

test("Mac SessionStore exposes fail-closed completeness state", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const responses = [
    { success: true, data: { state: null } },
    { success: true, data: { state: "incomplete" } },
    { success: true, data: { state: "incomplete" } },
    { success: true, data: { state: "complete" } },
    { success: true, data: { state: "complete" } },
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const store = new NativeLiveMacProviderSessionStore(
    "https://relay.example",
    "secret-token",
    fakeFetch,
  );

  assert.equal(await store.getStatus("s1"), null);
  await store.markIncomplete("s1");
  assert.equal(await store.getStatus("s1"), "incomplete");
  await store.markComplete("s1");
  assert.equal(await store.getStatus("s1"), "complete");

  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://relay.example/internal/native-live-session-store/status",
      "https://relay.example/internal/native-live-session-store/mark-incomplete",
      "https://relay.example/internal/native-live-session-store/status",
      "https://relay.example/internal/native-live-session-store/mark-complete",
      "https://relay.example/internal/native-live-session-store/status",
    ],
  );
  for (const call of calls) {
    assert.deepEqual(call.body, {
      session_id: "s1",
    });
  }
});
