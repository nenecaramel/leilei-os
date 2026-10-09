import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { durableCheckpointPrefix, checkpointForkSessionStore } from "../src/provider-checkpoint-prefix.mjs";
import { durableCheckpointPrefix as publicPrefix } from "../src/agent-sdk-claude-transport.mjs";

const entry = (uuid, parentUuid, type = "assistant", extra = {}) => ({ uuid, parentUuid, type, ...extra });
const rejectsPrefix = (entries, id) => assert.throws(() => durableCheckpointPrefix(entries, id), (error) => error.runtimeCode === "NO_PROVIDER_SESSION");

test("pure checkpoint module is SDK/filesystem independent and preserves public export", () => {
  assert.equal(publicPrefix, durableCheckpointPrefix);
  const source = readFileSync(new URL("../src/provider-checkpoint-prefix.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
});

test("canonical ancestry excludes failed branches and sidechains without mutating entries", () => {
  const entries = [entry("u", null, "user"), entry("failed", "u"), entry("side", "u", "assistant", { isSidechain: true }), { type: "queue-operation", operation: "remove" }, entry("a", "u"), entry("tail", "a")];
  const before = structuredClone(entries);
  const result = durableCheckpointPrefix(entries, "a");
  assert.deepEqual(result.prefix, [entries[0], entries[3], entries[4]]);
  assert.deepEqual([...result.ancestry], ["a", "u"]);
  assert.deepEqual(entries, before);
});

test("attachment and compact system ancestry remain valid carriers", () => {
  const entries = [entry("u", null, "user"), entry("file", "u", "attachment"), entry("compact", "file", "system"), entry("a", "compact")];
  assert.deepEqual(durableCheckpointPrefix(entries, "a").prefix, entries);
});

test("missing checkpoint, sidechain-only checkpoint and invalid input remain fail closed", () => {
  for (const entries of [null, [], [entry("a", null, "assistant", { isSidechain: true })]]) rejectsPrefix(entries, "a");
});

test("missing ancestors, cycles, invalid parents and conflicting carriers remain fail closed", () => {
  for (const entries of [
    [entry("a", "missing")],
    [entry("u", "a", "user"), entry("a", "u")],
    [entry("a", 12)],
    [entry("u", null, "user"), entry("u", "elsewhere", "user"), entry("a", "u")],
  ]) rejectsPrefix(entries, "a");
});

test("latest identical carrier does not alter prefix validation", () => {
  const entries = [entry("u", null, "user"), entry("a", "u"), entry("a", "u")];
  assert.deepEqual(durableCheckpointPrefix(entries, "a").prefix, entries);
});

test("query-local view isolates session/subpath and keeps writes bound to real store", async () => {
  const entries = [entry("u", null, "user"), entry("a", "u"), entry("tail", "a")];
  const writes = [];
  const store = { async load() { assert.equal(this, store); return entries; }, async append(key, batch) { assert.equal(this, store); writes.push([key, batch]); } };
  const view = checkpointForkSessionStore(store, "A", "a", true);
  assert.deepEqual(await view.load({ sessionId: "A" }), entries.slice(0, 2));
  assert.equal(await view.load({ sessionId: "B" }), entries);
  assert.equal(await view.load({ sessionId: "A", subpath: "agent/x" }), entries);
  await view.append({ sessionId: "A" }, [entry("new", "a")]);
  assert.equal(writes.length, 1);
  assert.equal(entries.length, 3);
});

test("legacy unvalidated view retains slice semantics and missing-checkpoint error", async () => {
  const entries = [entry("a", "missing"), entry("tail", "a")];
  const store = { async load() { return entries; } };
  assert.deepEqual(await checkpointForkSessionStore(store, "A", "a").load({ sessionId: "A" }), entries.slice(0, 1));
  await assert.rejects(checkpointForkSessionStore(store, "A", "absent").load({ sessionId: "A" }), (error) => error.runtimeCode === "NO_PROVIDER_SESSION" && error.parentSessionId === "A");
});

test("absent store or checkpoint leaves store identity unchanged", () => {
  const store = {};
  assert.equal(checkpointForkSessionStore(null, "A", "a"), null);
  assert.equal(checkpointForkSessionStore(store, null, "a"), store);
  assert.equal(checkpointForkSessionStore(store, "A", null), store);
});
