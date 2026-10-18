import assert from "node:assert/strict";
import test from "node:test";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { mindSnapshotVersion, snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { ClaudeCodeMindRecallService } from "../src/domains/runtime/mind/claude-code-mind-recall.js";
import { DEFAULT_MIND_LOOP_CONFIG } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function memory(n: number, text: string): SubjectStateWrite {
  return createMindState({id: uuid(n), userId: "u1", subjectId: "G", kind: "memory", text,
    source: {origin: "manual", occurredAt: null, note: null}});
}
const receipts = {
  create: async () => ({recall_id: uuid(80), context_sha256: "a".repeat(64)}),
  confirm: async () => ({outcome: "confirmed" as const}),
};

test("snapshot excludes invalid, non-global and hidden memories; version tracks text and status", () => {
  const valid = memory(1, "他曾经答应不会再这样");
  const hidden = memory(2, "private system note");
  hidden.envelope.scope.visibility = "hidden_system";
  const invalid = memory(3, "invalid");
  invalid.envelope.status.validityStatus = "invalidated";
  const scoped = memory(4, "conversation-scoped");
  scoped.envelope.scope = {...scoped.envelope.scope, applicability: "conversation",
    conversationId: "different"};
  const states = [valid, hidden, invalid, scoped];
  assert.deepEqual(snapshotMemories(states), [{stateId: uuid(1), text: valid.text}]);
  const before = mindSnapshotVersion(states);
  valid.text = "他曾答应不会再重复";
  assert.notEqual(mindSnapshotVersion(states), before);
  const afterEdit = mindSnapshotVersion(states);
  valid.envelope.status.pathStatus = "superseded";
  assert.notEqual(mindSnapshotVersion(states), afterEdit);
  assert.equal(snapshotMemories(states).length, 0);
});

test("verified current snapshot uses meaning-based scores, rejects keyword distraction and empty results", async () => {
  const states = [memory(1, "你又这样对我"), memory(2, "过去反复发生的承诺失信和争执")];
  const reader = {list: async () => states};
  const service = new ClaudeCodeMindRecallService(reader, DEFAULT_MIND_LOOP_CONFIG, "G", receipts);
  const initial = await service.snapshot({userId: "u1", offset: 0});
  assert.equal(initial.total, 2);
  assert.equal(initial.next_offset, null);
  const input = {userId: "u1", sessionId: "s", query: "你又这样对我", excludeIds: []};
  const selected = await service.recall({
    ...input, semanticSnapshotVersion: initial.version,
    snapshotScores: new Map([[uuid(2), .95]]),
  });
  assert.equal(selected.semantic_mode, "snapshot_v1");
  assert.deepEqual(selected.memory_ids, [uuid(2)]);
  const empty = await service.recall({
    ...input, semanticSnapshotVersion: initial.version, snapshotScores: new Map(),
  });
  assert.equal(empty.semantic_mode, "snapshot_v1");
  assert.deepEqual(empty.memory_ids, []);
  assert.equal(empty.context, "");
  states[1]!.text = "changed since cached";
  const stale = await service.recall({
    ...input, semanticSnapshotVersion: initial.version,
    snapshotScores: new Map([[uuid(2), .95]]),
  });
  assert.equal(stale.semantic_mode, "legacy");
  assert.deepEqual(stale.memory_ids, [uuid(1)]);
});

test("cached snapshot cannot rank hidden or missing IDs", async () => {
  const states = [memory(1, "tea"), memory(2, "secret")];
  states[1]!.envelope.scope.visibility = "hidden_system";
  const service = new ClaudeCodeMindRecallService({list: async () => states},
    DEFAULT_MIND_LOOP_CONFIG, "G", receipts);
  const version = (await service.snapshot({userId: "u1", offset: 0})).version;
  const rejected = await service.recall({
    userId: "u1", sessionId: "s", query: "tea", excludeIds: [],
    semanticSnapshotVersion: version,
    snapshotScores: new Map([[uuid(2), 1]]),
  });
  assert.equal(rejected.semantic_mode, "legacy");
  assert.ok(!rejected.memory_ids.includes(uuid(2)));
});

test("Claude Code recall returns snapshot version and caps lexical fallback at two",async()=>{
  const states=[memory(11,"tea"),memory(12,"tea friend"),memory(13,"tea friend forever")];
  const service=new ClaudeCodeMindRecallService({list:async()=>states},
    DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
  const result=await service.recall({
    userId:"u1",sessionId:"s",query:"tea",excludeIds:[],
  });
  assert.match(result.snapshot_version,/^[a-f0-9]{64}$/);
  assert.ok(result.memory_ids.length<=2);
});

test("Claude indexed retrieval does not read full Mind and verifies only current candidates",async()=>{
  let states=[memory(20,"柠檬黄是我喜欢的颜色"),memory(21,"以前谈过的承诺")];
  let calls=0;
  const reader={
    list:async()=>{throw new Error("A full Mind scan is forbidden on Claude recall");},
    searchGlobalRecallCandidates:async(input:{userId:string;subjectId:string;query:string;excludeIds:readonly string[]})=>{
      calls++;
      assert.equal(input.userId,"u1");assert.equal(input.subjectId,"G");
      assert.equal(input.query,"现在：你答应过的事情。前文：我们聊过承诺");
      return states.filter(x=>!input.excludeIds.includes(x.id));
    },
  };
  const service=new ClaudeCodeMindRecallService(reader,DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
  const base={userId:"u1",sessionId:"s",query:"你答应过的事情",
    candidateQuery:"现在：你答应过的事情。前文：我们聊过承诺",
    retrievalMode:"hybrid_conditional_v1" as const,excludeIds:[]};
  const first=await service.recall(base);
  assert.equal(first.semantic_candidates.length,2);
  const selected=await service.recall({...base,semanticSnapshotVersion:first.snapshot_version,
    snapshotScores:new Map([[uuid(20),.99]])});
  assert.equal(selected.semantic_mode,"snapshot_v1");
  assert.deepEqual(selected.memory_ids,[uuid(20)]);
  // The current server view changed: stale Mac choices must not override it.
  states=states.filter(x=>x.id!==uuid(20));
  const stale=await service.recall({...base,semanticSnapshotVersion:first.snapshot_version,
    snapshotScores:new Map([[uuid(20),.99]])});
  assert.equal(stale.semantic_mode,"legacy");
  assert.ok(!stale.memory_ids.includes(uuid(20)));
  assert.equal(calls,3);
});

test("per-request candidate limit is unrelated to the total database size",async()=>{
  const picked=[memory(100,"初次见面聊过颜色"),memory(101,"曾经聊过的颜色")];
  const service=new ClaudeCodeMindRecallService({
    list:async()=>{throw new Error("Must not read 10k rows");},
    searchGlobalRecallCandidates:async()=>picked,
  },DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
  const result=await service.recall({userId:"u1",sessionId:"s",query:"颜色",retrievalMode:"hybrid_conditional_v1",excludeIds:[]});
  assert.equal(result.semantic_candidates.length,2);
});

test("opt-in Claude indexed recall never silently scans whole Memory without an index",async()=>{
  const service=new ClaudeCodeMindRecallService({
    list:async()=>{throw new Error("FULL_DATABASE_READ_FORBIDDEN");},
  },DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
  await assert.rejects(service.recall({
    userId:"u1",sessionId:"s",query:"颜色",
    retrievalMode:"hybrid_conditional_v1",excludeIds:[],
  }),/Claude indexed candidate search unavailable/);
});

test("default Claude recall stays on the original list path when hybrid is not enabled",async()=>{
  const records=[memory(300,"记忆里提过酸甜的水果")];
  let legacy=0,indexed=0;
  const service=new ClaudeCodeMindRecallService({
    list:async()=>{legacy++;return records;},
    searchGlobalRecallCandidates:async()=>{indexed++;return [];},
  },DEFAULT_MIND_LOOP_CONFIG,"G",receipts);
  const result=await service.recall({userId:"u1",sessionId:"s",
    query:"水果",excludeIds:[]});
  assert.equal(legacy,1);
  assert.equal(indexed,0);
  assert.deepEqual(result.memory_ids,[uuid(300)]);
});
