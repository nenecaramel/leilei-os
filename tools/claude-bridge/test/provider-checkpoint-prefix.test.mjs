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

test("a checkpoint fork retains the latest native session Cron table outside message ancestry",async()=>{
  const original={type:"session_cron_carry",jobs:[{id:"first",cron:"0 9 * * *",recurring:true,createdAt:100}]};
  const replaced={type:"session_cron_carry",jobs:[{id:"first",cron:"0 9 * * *",recurring:true,createdAt:100},{id:"second",cron:"0 10 * * *",createdAt:200}]};
  const latest={type:"session_cron_carry",jobs:[{id:"first",cron:"0 9 * * *",recurring:true,createdAt:100}]};
  const entries=[entry("u",null,"user"),original,entry("checkpoint","u"),
    entry("later","checkpoint"),replaced,latest];
  const before=structuredClone(entries);
  const projected=durableCheckpointPrefix(entries,"checkpoint");
  assert.deepEqual(projected.prefix,[entries[0],original,latest,entries[2]],
    "carry the latest session schedule exactly once, without later chat");
  assert.deepEqual([...projected.ancestry],["checkpoint","u"]);
  assert.deepEqual(entries,before,"the source session must never be mutated");
  const store={async load(){return entries;}};
  assert.deepEqual(await checkpointForkSessionStore(store,"parent","checkpoint",true).load({sessionId:"parent"}),
    projected.prefix);
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

test("parallel tool calls keep every result, so a fork copies the turn unchanged", () => {
  // Claude writes each parallel tool_use as its own record; the first call's result
  // hangs off the first record, outside the ancestry of the second.
  const use = (id) => ({ message: { id: "msg", content: [{ type: "tool_use", id }] } });
  const result = (id) => ({ message: { content: [{ type: "tool_result", tool_use_id: id }] } });
  const entries = [entry("u", null, "user"), entry("t1", "u", "assistant", use("A")), entry("t2", "t1", "assistant", use("B")),
    entry("r1", "t1", "user", result("A")), entry("r2", "t2", "user", result("B")), entry("a", "r2"),
    entry("stray", "t1", "user", result("Z")), entry("failed", "u", "user", result("A"))];
  assert.deepEqual(durableCheckpointPrefix(entries, "a").prefix.map(e => e.uuid), ["u", "t1", "t2", "r1", "r2", "a"]);
  assert.deepEqual([...durableCheckpointPrefix(entries, "a").ancestry], ["a", "r2", "t2", "t1", "u"], "ancestry is unchanged");
});

test("only an unanswered call's single result is kept: never a reused UUID, a duplicate or a competing result", () => {
  const use = (...ids) => ({ message: { id: "msg", content: ids.map(id => ({ type: "tool_use", id })) } });
  const result = (id) => ({ message: { content: [{ type: "tool_result", tool_use_id: id }] } });
  const text = { message: { content: [{ type: "text", text: "failed branch" }] } };
  // A failed-branch message shares its UUID with a result record: neither copy is kept.
  const reused = [entry("u", null, "user"), entry("t1", "u", "assistant", use("A")), entry("r1", "u", "user", text),
    entry("t2", "t1", "assistant", use("B")), entry("r1", "t1", "user", result("A")), entry("r2", "t2", "user", result("B")), entry("a", "r2")];
  assert.deepEqual(durableCheckpointPrefix(reused, "a").prefix.map(e => e.uuid), ["u", "t1", "t2", "r2", "a"]);
  // A call already answered in the ancestry gets no second result.
  const answered = [entry("u", null, "user"), entry("t1", "u", "assistant", use("A")), entry("r1", "t1", "user", result("A")),
    entry("dup", "t1", "user", result("A")), entry("a", "r1")];
  assert.deepEqual(durableCheckpointPrefix(answered, "a").prefix.map(e => e.uuid), ["u", "t1", "r1", "a"]);
  // Two competing results for one unanswered call: keep neither.
  const competing = [entry("u", null, "user"), entry("t1", "u", "assistant", use("A")), entry("t2", "t1", "assistant", use("B")),
    entry("x1", "t1", "user", result("A")), entry("x2", "t1", "user", result("A")), entry("r2", "t2", "user", result("B")), entry("a", "r2")];
  assert.deepEqual(durableCheckpointPrefix(competing, "a").prefix.map(e => e.uuid), ["u", "t1", "t2", "r2", "a"]);
});

test("sibling result UUIDs must identify one record, even with an unchanged parent", () => {
  const use = id => ({ message: { content: [{ type: "tool_use", id }] } });
  const result = text => entry("r1", "t1", "user", { message: { content: [{ type: "tool_result", tool_use_id: "A", content: text }] } });
  const start = [entry("u", null, "user"), entry("t1", "u", "assistant", use("A")), entry("t2", "t1", "assistant", use("B"))];
  const end = [entry("r2", "t2", "user", { message: { content: [{ type: "tool_result", tool_use_id: "B" }] } }), entry("a", "r2")];
  const plain = entry("r1", "t1", "user", { message: { content: [{ type: "text", text: "synthetic unrelated text" }] } });
  for (const duplicates of [
    [plain, result("answer")], [result("answer"), plain],
    [result("old answer"), result("new answer")],
    [result("answer"), result("answer")],
    [{ uuid: "r1", type: "user", message: plain.message }, result("answer")],
  ]) {
    const entries = [...start, ...duplicates, ...end];
    const before = structuredClone(entries);
    assert.deepEqual(durableCheckpointPrefix(entries, "a").prefix.map(e => e.uuid), ["u", "t1", "t2", "r2", "a"]);
    assert.deepEqual(entries, before, "ambiguous candidates do not mutate durable history");
  }
  const selected = result("answer");
  assert.deepEqual(durableCheckpointPrefix([
    ...start, { ...selected, isSidechain: true }, selected, ...end, result("later"),
  ], "a").prefix.map(e => e.uuid), ["u", "t1", "t2", "r1", "r2", "a"], "sidechain and post-checkpoint records do not invalidate a unique canonical candidate");
});
