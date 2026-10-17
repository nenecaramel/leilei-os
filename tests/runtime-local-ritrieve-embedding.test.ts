import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";

async function fakeWorker(t: import("node:test").TestContext, response: string) {
  const directory = await mkdtemp(join(tmpdir(), "mind-ritrieve-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "worker.mjs");
  await writeFile(path, `
    import { createInterface } from "node:readline";
    for await (const line of createInterface({ input: process.stdin })) {
      const input = JSON.parse(line);
      ${response}
    }
  `);
  return path;
}

test("ritrieve worker scores preserve candidate IDs and reuse one process", async t => {
  const path = await fakeWorker(t, 'process.stdout.write(JSON.stringify({id: input.id, scores: input.passages.map((_, i) => i / 2)}) + "\\n");');
  const scorer = new LocalRitrieveBreathSemanticScorer({
    executable: process.execPath,
    workerPath: path,
    requestTimeoutMs: 3_000,
  });
  t.after(() => scorer.close());
  const first = await scorer.score({
    query: "你又这样对我",
    candidates: [
      { stateId: "memory-one", kind: "memory", text: "曾经发生过的争执" },
      { stateId: "memory-two", kind: "memory", text: "和今天无关的笔记" },
    ],
  });
  assert.deepEqual([...first.entries()], [["memory-one", 0], ["memory-two", .5]]);
  const second = await scorer.score({
    query: "继续",
    candidates: [{ stateId: "memory-three", kind: "memory", text: "另一段往事" }],
  });
  assert.equal(second.get("memory-three"), 0);
});

test("ritrieve rejects invalid scores rather than injecting fake semantic evidence", async t => {
  const path = await fakeWorker(t, 'process.stdout.write(JSON.stringify({id: input.id, scores: [1.1]}) + "\\n");');
  const scorer = new LocalRitrieveBreathSemanticScorer({
    executable: process.execPath, workerPath: path, requestTimeoutMs: 3_000,
  });
  t.after(() => scorer.close());
  await assert.rejects(scorer.score({
    query: "test",
    candidates: [{stateId: "one", kind: "memory", text: "test memory"}],
  }), /invalid semantic scores/);
});

test("ritrieve validates candidate constraints before invoking a worker", async () => {
  const scorer = new LocalRitrieveBreathSemanticScorer();
  await assert.rejects(scorer.score({
    query: "test", candidates: [{stateId: "one", kind: "memory", text: " "}],
  }), /candidate text is invalid/);
});

test("ritrieve indexes snapshots atomically and returns ranked local memory IDs", async t => {
  const version = "a".repeat(64);
  const path = await fakeWorker(t, `
    if (input.op === "search") {
      process.stdout.write(JSON.stringify({id:input.id,version:"${version}",count:2,
        hits:[["memory-two",.93],["memory-one",.70]],floor:.73})+"\\n");
    } else {
      process.stdout.write(JSON.stringify({id:input.id,ok:true})+"\\n");
    }
  `);
  const scorer = new LocalRitrieveBreathSemanticScorer({
    executable: process.execPath, workerPath: path, requestTimeoutMs: 3000,
  });
  t.after(() => scorer.close());
  assert.equal(scorer.isSnapshotReady(), false);
  await scorer.replaceSnapshot({version, memories:[
    {stateId:"memory-one",text:"雨天的约定"},
    {stateId:"memory-two",text:"我们之前的争执"},
  ]});
  assert.equal(scorer.isSnapshotReady(), true);
  const result = await scorer.searchSnapshot("又这样", 2);
  assert.deepEqual(result, {version,count:2,floor:.73,
    hits:[{stateId:"memory-two",score:.93},{stateId:"memory-one",score:.70}]});
  await assert.rejects(scorer.replaceSnapshot({version, memories:[
    {stateId:"same",text:"a"},{stateId:"same",text:"b"},
  ]}),/Invalid Mind snapshot/);
});
