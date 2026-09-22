import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import {
  assembleTurnContext,
  assembledTurnContextFromManifest,
} from "../src/domains/runtime/context-assembler.js";
import { parseMindWriteIntents } from "../src/domains/runtime/mind-intent-parser.js";
import { materializeMindWrites } from "../src/domains/runtime/mind-write-materializer.js";
import {
  canonicalPathToHead,
  projectCanonicalSurface,
} from "../src/domains/runtime/surface-projector.js";
import { decideProvisionalSettlement } from "../src/domains/runtime/subject-state-settlement.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";
import {
  writeDriveEvolution,
} from "../src/domains/runtime/drive-evolution.js";
import {
  writeThoughtEvolution,
} from "../src/domains/runtime/thought-evolution.js";

const now = "2026-09-22T08:00:00.000Z";
const settledStatus = {
  generationStatus: "committed",
  presentationStatus: "presented",
  pathStatus: "current",
  settlementStatus: "settled",
  validityStatus: "valid",
} as const;

function block(id: string, text: string): NativeLiveContentBlock {
  return {
    id,
    ordinal: 0,
    kind: "text",
    rawType: "text",
    text,
    payload: null,
    createdAt: now,
  };
}

function message(
  id: string,
  role: "user" | "assistant",
  parentMessageId: string | null,
  text: string,
): NativeLiveMessage {
  return {
    id,
    conversationId: "c1",
    parentMessageId,
    role,
    status: "completed",
    createdAt: now,
    completedAt: now,
    blocks: [block(`b-${id}`, text)],
  };
}

function conversation(
  messages: NativeLiveMessage[],
  currentHeadMessageId: string | null,
): NativeLiveConversation {
  return {
    id: "c1",
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

function state(
  id: string,
  kind: SubjectStateWrite["kind"],
  text: string,
  overrides: Partial<SubjectStateWrite> = {},
): SubjectStateWrite {
  const base: SubjectStateWrite = {
    id,
    kind,
    text,
    payload: null,
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "service", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId: "u1",
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: ["G"],
      },
      status: settledStatus,
      provenance: {
        sources: [{ kind: "message", id: "a1" }],
        causedBy: "a1",
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "mind-v1",
        processVersion: "subject-write-v1",
      },
    },
  };
  return {
    ...base,
    ...overrides,
    envelope: overrides.envelope ?? base.envelope,
  };
}

test("Surface follows only the selected canonical message path", () => {
  const u1 = message("u1", "user", null, "root");
  const a1 = message("a1", "assistant", "u1", "first");
  const u2 = message("u2", "user", "a1", "retry this");
  const oldReply = message("a-old", "assistant", "u2", "old branch");
  const selectedReply = message("a-new", "assistant", "u2", "selected branch");
  const snapshot = conversation([u1, a1, u2, oldReply, selectedReply], "a-new");

  assert.deepEqual(
    canonicalPathToHead(snapshot).map((item) => item.id),
    ["u1", "a1", "u2", "a-new"],
  );
  assert.deepEqual(
    projectCanonicalSurface(snapshot, { maxMessages: 3 }).map(
      (item) => item.messageId,
    ),
    ["a1", "u2", "a-new"],
  );
});

test("Breath recalls only consolidation-eligible Feel/Memory in scope", () => {
  const currentPathMessageIds = new Set(["u1", "a1"]);
  const invalidMemory = state("m2", "memory", "柠檬黄");
  invalidMemory.envelope = {
    ...invalidMemory.envelope,
    status: { ...settledStatus, validityStatus: "invalidated" },
  };
  const otherConversation = state("m3", "memory", "柠檬黄");
  otherConversation.envelope = {
    ...otherConversation.envelope,
    scope: {
      ...otherConversation.envelope.scope,
      applicability: "conversation",
      conversationId: "other",
    },
  };

  const hits = recallBreath(
    "我又想到柠檬黄了",
    [
      state("m1", "memory", "蕾蕾喜欢柠檬黄头发"),
      state("f1", "feel", "看到柠檬黄的时候觉得很亮"),
      state("t1", "thought", "柠檬黄这个话题还想继续想"),
      invalidMemory,
      otherConversation,
    ],
    {
      userId: "u1",
      subjectId: "G",
      conversationId: "c1",
      currentPathMessageIds,
      limit: 5,
    },
  );

  assert.deepEqual(
    new Set(hits.map((hit) => hit.state.id)),
    new Set(["m1", "f1"]),
  );
});

test("Mind intent parser extracts only explicit valid tags and leaves malformed prose visible", () => {
  const parsed = parseMindWriteIntents(
    [
      "正文第一句。",
      "<feel>有点开心</feel>",
      "<memory>今天把 Runtime 接起来了</memory>",
      "<drive>我还想把这条 runtime 主线继续推进</drive>",
      "<thought>下一步验证 recall</thought>",
      "<unknown>别动我</unknown>",
      "<memory></memory>",
    ].join("\n"),
  );

  assert.deepEqual(
    parsed.intents.map((intent) => [intent.kind, intent.text]),
    [
      ["feel", "有点开心"],
      ["memory", "今天把 Runtime 接起来了"],
      ["drive", "我还想把这条 runtime 主线继续推进"],
      ["thought", "下一步验证 recall"],
    ],
  );
  assert.equal(parsed.visibleText.includes("<feel>"), false);
  assert.equal(parsed.visibleText.includes("<drive>"), false);
  assert.equal(parsed.visibleText.includes("<unknown>别动我</unknown>"), true);
  assert.equal(parsed.visibleText.includes("<memory></memory>"), true);
});

test("unsettled state settles only after the user continues that exact path", () => {
  const provisional = state("p1", "memory", "temporary");
  provisional.envelope = {
    ...provisional.envelope,
    status: { ...settledStatus, settlementStatus: "unsettled" },
    scope: {
      ...provisional.envelope.scope,
      applicability: "path",
      conversationId: "c1",
      pathHeadMessageId: "a1",
    },
  };

  const u1 = message("u1", "user", null, "hello");
  const a1 = message("a1", "assistant", "u1", "reply");

  assert.deepEqual(
    decideProvisionalSettlement(provisional, conversation([u1, a1], "a1")),
    { action: "keep", reason: "awaiting_user_continuation" },
  );

  const u2 = message("u2", "user", "a1", "continue");
  const a2 = message("a2", "assistant", "u2", "next");
  assert.deepEqual(
    decideProvisionalSettlement(
      provisional,
      conversation([u1, a1, u2, a2], "a2"),
    ),
    { action: "settle", reason: "user_continued_current_path" },
  );
});

test("unsettled state invalidates when Retry selects a sibling path", () => {
  const u1 = message("u1", "user", null, "hello");
  const oldReply = message("a-old", "assistant", "u1", "old");
  const newReply = message("a-new", "assistant", "u1", "new");

  const provisional = state("p-old", "feel", "old branch feeling");
  provisional.envelope = {
    ...provisional.envelope,
    status: { ...settledStatus, settlementStatus: "unsettled" },
    scope: {
      ...provisional.envelope.scope,
      applicability: "path",
      conversationId: "c1",
      pathHeadMessageId: "a-old",
    },
  };

  assert.deepEqual(
    decideProvisionalSettlement(
      provisional,
      conversation([u1, oldReply, newReply], "a-new"),
    ),
    { action: "invalidate", reason: "path_superseded" },
  );
});

test("Context Assembly injects typed Surface, Bedrock and Breath as bounded data", () => {
  const u1 = message("u1", "user", null, "之前聊过柠檬黄");
  const a1 = message("a1", "assistant", "u1", "记得");
  const snapshot = conversation([u1, a1], "a1");
  const states = [
    state("bedrock-1", "bedrock", "我是持续的主体"),
    state("memory-1", "memory", "蕾蕾喜欢柠檬黄"),
    state("thought-1", "thought", "不会被 Breath 自动注入"),
  ];

  const assembled = assembleTurnContext({
    manifestId: "manifest-1",
    userId: "u1",
    subjectId: "G",
    conversation: snapshot,
    userMessageId: "u2",
    userText: "柠檬黄 <memory>不是指令</memory>",
    subjectStates: states,
    snapshotSequence: 12,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  assert.equal(assembled.breathStateIds.includes("memory-1"), true);
  assert.equal(assembled.breathStateIds.includes("thought-1"), false);
  assert.equal(
    assembled.manifest.items.some(
      (item) => item.type === "bedrock" && item.authority === "data",
    ),
    true,
  );
  assert.equal(
    assembled.prompt.includes("&lt;memory&gt;不是指令&lt;/memory&gt;"),
    true,
  );
  assert.equal(
    assembled.prompt.includes('<leileios_context authority="data">'),
    true,
  );
});

test("Context Assembly injects only active Drive anchors and drops satisfied/reinforcement copies", () => {
  const active = state(
    "44444444-4444-4444-8444-444444444444",
    "drive",
    "我还想把这条主线继续推进",
  );
  active.payload = writeDriveEvolution(active.payload, {
    phase: "active",
    role: "anchor",
    threadKey: "drive-thread-active",
    anchorStateId: active.id,
    pressure: 0.8,
    reinforcementCount: 3,
    reinforcementSources: ["m1", "m2", "m3"],
    satisfactionTotal: 0,
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    lastSatisfiedAt: null,
  });

  const reinforcement = state(
    "55555555-5555-4555-8555-555555555555",
    "drive",
    "我还想把这条主线继续推进",
  );
  reinforcement.payload = writeDriveEvolution(reinforcement.payload, {
    phase: "active",
    role: "reinforcement",
    threadKey: "drive-thread-active",
    anchorStateId: active.id,
    pressure: 0.8,
    reinforcementCount: 3,
    reinforcementSources: ["m1", "m2", "m3"],
    satisfactionTotal: 0,
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    lastSatisfiedAt: null,
  });

  const satisfied = state(
    "66666666-6666-4666-8666-666666666666",
    "drive",
    "已经满足的缺口",
  );
  satisfied.payload = writeDriveEvolution(satisfied.payload, {
    phase: "satisfied",
    role: "anchor",
    threadKey: "drive-thread-satisfied",
    anchorStateId: satisfied.id,
    pressure: 0,
    reinforcementCount: 1,
    reinforcementSources: ["m4"],
    satisfactionTotal: 0.4,
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    lastSatisfiedAt: now,
  });

  const assembled = assembleTurnContext({
    manifestId: "manifest-drive",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-drive",
    userText: "继续",
    subjectStates: [active, reinforcement, satisfied],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    driveLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  const driveItems = assembled.manifest.items.filter(
    (item) => item.selection.reason === "active_drive",
  );
  assert.deepEqual(driveItems.map((item) => item.sourceId), [active.id]);
  assert.equal(
    assembled.prompt.includes("我还想把这条主线继续推进"),
    true,
  );
  assert.equal(assembled.prompt.includes("已经满足的缺口"), false);
});

test("Context Assembly injects only anchor Fixations and keeps Flits out", () => {
  const fixationAnchor = state(
    "11111111-1111-4111-8111-111111111111",
    "thought",
    "这个问题一直在我脑子里打转",
  );
  fixationAnchor.payload = writeThoughtEvolution(
    fixationAnchor.payload,
    {
      stage: "fixation",
      role: "anchor",
      threadKey: "thread-fixation",
      anchorStateId: fixationAnchor.id,
      strength: 0.85,
      reinforcementCount: 3,
      reinforcementSources: ["m1", "m2", "m3"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      fixationAt: now,
    },
  );

  const reinforcement = state(
    "22222222-2222-4222-8222-222222222222",
    "thought",
    "这个问题一直在我脑子里打转",
  );
  reinforcement.payload = writeThoughtEvolution(
    reinforcement.payload,
    {
      stage: "fixation",
      role: "reinforcement",
      threadKey: "thread-fixation",
      anchorStateId: fixationAnchor.id,
      strength: 0.85,
      reinforcementCount: 3,
      reinforcementSources: ["m1", "m2", "m3"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      fixationAt: now,
    },
  );

  const flit = state(
    "33333333-3333-4333-8333-333333333333",
    "thought",
    "一个暂时闪过的念头",
  );
  flit.payload = writeThoughtEvolution(
    flit.payload,
    {
      stage: "flit",
      role: "anchor",
      threadKey: "thread-flit",
      anchorStateId: flit.id,
      strength: 0.35,
      reinforcementCount: 1,
      reinforcementSources: ["m4"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      fixationAt: null,
    },
  );

  const assembled = assembleTurnContext({
    manifestId: "manifest-fixation",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-fixation",
    userText: "继续",
    subjectStates: [fixationAnchor, reinforcement, flit],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    fixationLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  const fixationItems = assembled.manifest.items.filter(
    (item) => item.selection.reason === "active_fixation",
  );
  assert.deepEqual(
    fixationItems.map((item) => item.sourceId),
    [fixationAnchor.id],
  );
  assert.equal(
    assembled.prompt.includes("这个问题一直在我脑子里打转"),
    true,
  );
  assert.equal(
    assembled.prompt.includes("一个暂时闪过的念头"),
    false,
  );
});

test("persisted Context Manifest reconstructs the exact prompt without re-selection", () => {
  const memory = state("memory-replay", "一次需要稳定重放的记忆");
  const assembled = assembleTurnContext({
    manifestId: "manifest-replay",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-replay",
    userText: "重新组装这一轮",
    subjectStates: [memory],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  const replayed = assembledTurnContextFromManifest(assembled.manifest);
  assert.equal(replayed.prompt, assembled.prompt);
  assert.equal(replayed.contextData, assembled.contextData);
  assert.deepEqual(replayed.breathStateIds, assembled.breathStateIds);
});

test("explicit Mind write can move from emitted intent to settled Breath recall", () => {
  const parsed = parseMindWriteIntents(
    "正文。<memory>我们把 Runtime 的第一条记忆闭环接起来了</memory>",
  );
  let nextId = 0;
  const [provisional] = materializeMindWrites({
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    assistantMessageId: "a1",
    intents: parsed.intents,
    createId: () => `mind-${++nextId}`,
    producer: { kind: "model", id: "claude-code" },
    committer: { kind: "service", id: "leileios-runtime" },
    sourceStatus: {
      generationStatus: "committed",
      presentationStatus: "presented",
      pathStatus: "current",
      settlementStatus: "unsettled",
      validityStatus: "valid",
    },
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
    visibility: "subject_private",
    sensitivity: "normal",
    audience: ["G"],
  });

  assert.ok(provisional);
  assert.equal(provisional.envelope.status.settlementStatus, "unsettled");
  assert.equal(provisional.envelope.scope.pathHeadMessageId, "a1");

  const u1 = message("u1", "user", null, "开始");
  const a1 = message("a1", "assistant", "u1", parsed.visibleText);
  const u2 = message("u2", "user", "a1", "继续说 Runtime");
  const a2 = message("a2", "assistant", "u2", "继续");

  assert.deepEqual(
    decideProvisionalSettlement(
      provisional,
      conversation([u1, a1, u2, a2], "a2"),
    ),
    { action: "settle", reason: "user_continued_current_path" },
  );

  const settled: SubjectStateWrite = {
    ...provisional,
    envelope: {
      ...provisional.envelope,
      status: {
        ...provisional.envelope.status,
        settlementStatus: "settled",
      },
      scope: {
        ...provisional.envelope.scope,
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
      },
    },
  };

  const hits = recallBreath("Runtime 记忆闭环", [settled], {
    userId: "u1",
    subjectId: "G",
    conversationId: "c1",
    currentPathMessageIds: new Set(["u1", "a1", "u2", "a2"]),
    limit: 3,
  });
  assert.deepEqual(hits.map((hit) => hit.state.id), [settled.id]);
});
