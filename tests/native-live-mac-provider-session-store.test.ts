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

test("Mac SessionStore keeps append receipts across restart, including partially committed chunks", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-append-receipt-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = new Map<string, unknown[]>();
  let loseResponse = true;
  let calls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const identity = JSON.stringify([body.key, body.append_batch_id]);
    if (!remote.has(identity)) remote.set(identity, body.entries);
    calls += 1;
    if (loseResponse && calls === 2) throw new Error("committed second chunk, lost response");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "restart", subpath: "subagents/a" };
  const entries = [
    { type: "assistant", uuid: "logical-1", text: "x".repeat(3_100_000) },
    { type: "assistant", uuid: "logical-2", text: "x".repeat(3_100_000) },
  ];
  const first = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await assert.rejects(first.append(key, entries), /lost response/u);
  loseResponse = false;
  const restarted = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await restarted.append(key, entries);
  assert.equal(remote.size, 2, "restart must reuse both committed chunk IDs");
  await new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory).append(key,
    entries.map((entry) => ({ text: entry.text, uuid: entry.uuid, type: entry.type })));
  assert.equal(remote.size, 2, "JSONB key ordering cannot change append identity");
  assert.equal([...remote.values()].flat().length, 2, "remote transcript must not duplicate");
  // Re-delivery after ACK/receipt cleanup is still the same logical append.
  await restarted.append(key, entries);
  assert.equal(remote.size, 2);
  // Same content with new SDK UUIDs is a genuinely distinct logical append.
  await restarted.append(key, entries.map((entry) => ({ ...entry, uuid: `${entry.uuid}-new` })));
  assert.equal(remote.size, 4);
  await restarted.append({ ...key, subpath: "subagents/b" }, entries);
  await restarted.append({ ...key, sessionId: "other" }, entries);
  assert.equal(remote.size, 8, "session/subpath isolate identities");
});

test("identical legitimate appends with explicit distinct intent IDs are never swallowed while a receipt is pending", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-marker-intent-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = new Set<string>();
  let lose = true;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    remote.add(body.append_batch_id);
    if (lose) throw new Error("response lost");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "marker-session" };
  const entries = [{ type: "custom-title", title: "same content" }];
  const first = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await assert.rejects(first.append(key, entries, "intent-one"), /response lost/u);
  lose = false;
  const restarted = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await restarted.append(key, entries, "intent-two");
  await restarted.append(key, entries, "intent-one");
  assert.equal(remote.size, 2);
});

test("UUID-less pending restart ambiguity fails closed without falsely deduplicating a new append", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-marker-ambiguity-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error("response lost"); };
  const key = { projectKey: "/local", sessionId: "marker" };
  const entries = [{ type: "custom-title", title: "same" }];
  await assert.rejects(new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory).append(key, entries), /response lost/u);
  await assert.rejects(new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory).append(key, entries), /logicalAppendId/u);
  assert.equal(calls, 1, "no speculative write/dedup of ambiguous marker");
});

test("startup recovery replays the durable UUID-less intent before a new identical SDK append", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-marker-replay-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = new Map<string, unknown>();
  let lose = true;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    remote.set(body.append_batch_id, body.entries);
    if (lose) throw new Error("response lost after marker commit");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "marker-startup" };
  const entries = [{ type: "custom-title", title: "same" }];
  await assert.rejects(new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory).append(key, entries), /response lost/u);
  const restarted = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await assert.rejects(restarted.recoverPendingAppends(), /response lost/u);
  assert.equal(remote.size, 1, "failed recovery reuses the durable operation");
  lose = false;
  await restarted.recoverPendingAppends();
  assert.equal(remote.size, 1, "startup recovery does not duplicate the committed marker");
  await restarted.append(key, entries);
  assert.equal(remote.size, 2, "a NEW identical marker is a distinct intent after recovery");
});

test("pending chunks replay in original order before any later append can commit", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-append-order-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = new Map<string, string[]>();
  let failSecond = true;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (failSecond && body.entries[0].uuid === "early-2") { failSecond = false; throw new Error("second chunk unavailable"); }
    if (!remote.has(body.append_batch_id)) remote.set(body.append_batch_id, body.entries.map((entry: { uuid: string }) => entry.uuid));
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "ordered" };
  const store = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await assert.rejects(store.append(key, [{ type: "assistant", uuid: "early-1", text: "x".repeat(3_100_000) }, { type: "assistant", uuid: "early-2", text: "x".repeat(3_100_000) }]), /second chunk/u);
  await store.append(key, [{ type: "assistant", uuid: "later", text: "later" }]);
  assert.deepEqual([...remote.values()].flat(), ["early-1", "early-2", "later"]);
});

test("concurrent identical UUID-less appends are serialized and keep distinct real intents", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-append-concurrent-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let active = 0, maximum = 0;
  const ids = new Set<string>();
  const fetchImpl: typeof fetch = async (_url, init) => {
    active += 1; maximum = Math.max(maximum, active);
    ids.add(JSON.parse(String(init?.body)).append_batch_id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "concurrent" };
  const store = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await Promise.all([store.append(key, [{ type: "custom-title", title: "same" }]), store.append(key, [{ type: "custom-title", title: "same" }])]);
  assert.equal(maximum, 1);
  assert.equal(ids.size, 2);
});

test("an untagged new UUID-less callback cannot be mistaken for a pending same-content intent", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-new-marker-fence-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let lose = true;
  const remote = new Set<string>();
  const fetchImpl: typeof fetch = async (_url, init) => {
    remote.add(JSON.parse(String(init?.body)).append_batch_id);
    if (lose) throw new Error("lost response");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const store = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  const key = { projectKey: "/local", sessionId: "new-marker" };
  await assert.rejects(store.append(key, [{ type: "tag", tag: "same" }]), /lost response/u);
  lose = false;
  await assert.rejects(store.append(key, [{ type: "tag", tag: "same" }]), /Ambiguous/u);
  assert.equal(remote.size, 1);
  await store.recoverPendingAppends();
  await store.append(key, [{ type: "tag", tag: "same" }]);
  assert.equal(remote.size, 2);
});

test("cleanup refuses a restarted session with durable append evidence until replay is acknowledged", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "leilei-cleanup-intent-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let lost = true, deletes = 0;
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url).endsWith("/delete")) deletes += 1;
    else if (lost) throw new Error("append response lost");
    return new Response(JSON.stringify({ success: true, data: null }));
  };
  const key = { projectKey: "/local", sessionId: "protected", subpath: "subagents/a" };
  await assert.rejects(new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory).append(key, [{ type: "assistant", uuid: "checkpoint" }]), /lost/u);
  const restarted = new NativeLiveMacProviderSessionStore("https://relay.example", "token", fetchImpl, directory);
  await assert.rejects(restarted.delete({ ...key, subpath: undefined }), /pending append/u);
  assert.equal(deletes, 0);
  await restarted.delete({ ...key, sessionId: "unrelated" });
  assert.equal(deletes, 1);
  lost = false;
  await restarted.recoverPendingAppends();
  await restarted.delete(key);
  assert.equal(deletes, 2);
});
