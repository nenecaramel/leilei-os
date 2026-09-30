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
import {
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import {
  writeCuriosityEvolution,
} from "../src/domains/runtime/curiosity-evolution.js";

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
      "<curiosity>为什么 Topic 会再次浮起来</curiosity>",
      "<topic>下次继续看 Topic Pool</topic>",
      "<dream>这个标签已经退出架构</dream>",
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
      ["curiosity", "为什么 Topic 会再次浮起来"],
    ],
  );
  assert.equal(parsed.visibleText.includes("<feel>"), false);
  assert.equal(parsed.visibleText.includes("<drive>"), false);
  assert.equal(parsed.visibleText.includes("<curiosity>"), false);
  assert.equal(
    parsed.visibleText.includes("<topic>下次继续看 Topic Pool</topic>"),
    true,
  );
  assert.equal(
    parsed.visibleText.includes("<dream>这个标签已经退出架构</dream>"),
    true,
  );
  assert.equal(parsed.visibleText.includes("<unknown>别动我</unknown>"), true);
  assert.equal(parsed.visibleText.includes("<memory></memory>"), true);
});

test("Context Assembly tells foreground Claude how to author current Mind writes", () => {
  const assembled = assembleTurnContext({
    manifestId: "manifest-mind-write-protocol",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-mind-write-protocol",
    userText: "记一下这一轮",
    subjectStates: [],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    breathLimit: 0,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  assert.equal(
    assembled.prompt.includes(
      '<leileios_mind_write authority="runtime_protocol">',
    ),
    true,
  );
  for (const tag of ["feel", "memory", "drive", "thought", "curiosity"]) {
    assert.equal(
      assembled.prompt.includes(`<${tag}>...</${tag}>`),
      true,
    );
  }
  assert.equal(
    assembled.prompt.includes(
      "Do not emit <topic>; Topic is derived by LeileiOS from Curiosity.",
    ),
    true,
  );
  assert.equal(
    assembled.prompt.includes("<topic>...</topic>"),
    false,
  );
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

test("Context Assembly injects bounded Breath but does not reinject canonical Surface", () => {
  const u1 = message("u1", "user", null, "之前聊过柠檬黄");
  u1.createdAt = "2026-09-24T02:32:00.000Z";
  u1.completedAt = "2026-09-24T02:32:00.000Z";
  const a1 = message("a1", "assistant", "u1", "记得");
  a1.createdAt = "2026-09-24T02:32:20.000Z";
  a1.completedAt = "2026-09-24T02:33:00.000Z";
  const snapshot = conversation([u1, a1], "a1");
  const states = [
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
    userMessageCreatedAt: "2026-09-24T07:47:00.000Z",
    contextTimeZone: "Asia/Shanghai",
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
    assembled.prompt.includes("&lt;memory&gt;不是指令&lt;/memory&gt;"),
    true,
  );
  assert.equal(
    assembled.prompt.includes('<leileios_context authority="data">'),
    true,
  );
  assert.equal(
    assembled.prompt.includes("[09-24 周四 10:32] user: 之前聊过柠檬黄"),
    false,
  );
  assert.equal(
    assembled.prompt.includes("[09-24 周四 10:33] assistant: 记得"),
    false,
  );
  assert.equal(
    assembled.manifest.items.some(
      (item) => item.selection.reason === "recent_canonical_surface",
    ),
    false,
  );
  assert.equal(
    assembled.prompt.includes(
      "<user_message>[09-24 周四 15:47] 柠檬黄 &lt;memory&gt;不是指令&lt;/memory&gt;</user_message>",
    ),
    true,
  );
});

test("unsettled or superseded Drive never enters Context Assembly", () => {
  const provisional = state(
    "77777777-7777-4777-8777-777777777777",
    "drive",
    "这条 Drive 还没有被当前路径确认",
  );
  provisional.payload = writeDriveEvolution(provisional.payload, {
    phase: "active",
    role: "anchor",
    threadKey: "drive-unsettled",
    anchorStateId: provisional.id,
    pressure: 0.8,
    reinforcementCount: 1,
    reinforcementSources: ["a-old"],
    satisfactionTotal: 0,
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    lastSatisfiedAt: null,
  });
  provisional.envelope = {
    ...provisional.envelope,
    status: {
      ...provisional.envelope.status,
      settlementStatus: "unsettled",
    },
    scope: {
      ...provisional.envelope.scope,
      applicability: "path",
      conversationId: "c1",
      pathHeadMessageId: "a-old",
    },
  };

  const superseded = state(
    "88888888-8888-4888-8888-888888888888",
    "drive",
    "已经被 Retry 放弃的 Drive",
  );
  superseded.payload = writeDriveEvolution(superseded.payload, {
    phase: "active",
    role: "anchor",
    threadKey: "drive-superseded",
    anchorStateId: superseded.id,
    pressure: 0.9,
    reinforcementCount: 2,
    reinforcementSources: ["a-old", "a-older"],
    satisfactionTotal: 0,
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    lastSatisfiedAt: null,
  });
  superseded.envelope = {
    ...superseded.envelope,
    status: {
      ...superseded.envelope.status,
      pathStatus: "superseded",
    },
  };

  const assembled = assembleTurnContext({
    manifestId: "manifest-drive-branch-safe",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-drive-branch-safe",
    userText: "继续",
    subjectStates: [provisional, superseded],
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

  assert.equal(
    assembled.manifest.items.some(
      (item) => item.selection.reason === "active_drive",
    ),
    false,
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

test("Context Assembly injects strongest active Thought anchors directly", () => {
  const strong = state(
    "11111111-1111-4111-8111-111111111111",
    "thought",
    "这个问题一直在我脑子里打转",
  );
  strong.payload = writeThoughtEvolution(
    strong.payload,
    {
      phase: "active",
      role: "anchor",
      threadKey: "thread-strong",
      anchorStateId: strong.id,
      strength: 0.85,
      reinforcementCount: 3,
      reinforcementSources: ["m1", "m2", "m3"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      dormantAt: null,
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
      phase: "active",
      role: "reinforcement",
      threadKey: "thread-strong",
      anchorStateId: strong.id,
      strength: 0.85,
      reinforcementCount: 3,
      reinforcementSources: ["m1", "m2", "m3"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      dormantAt: null,
    },
  );

  const weak = state(
    "33333333-3333-4333-8333-333333333333",
    "thought",
    "一个已经很弱的念头",
  );
  weak.payload = writeThoughtEvolution(
    weak.payload,
    {
      phase: "active",
      role: "anchor",
      threadKey: "thread-weak",
      anchorStateId: weak.id,
      strength: 0.05,
      reinforcementCount: 1,
      reinforcementSources: ["m4"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      dormantAt: null,
    },
  );

  const dormant = state(
    "44444444-4444-4444-8444-444444444444",
    "thought",
    "已经 dormant 的高强度残留也不能进 Context",
  );
  dormant.payload = writeThoughtEvolution(
    dormant.payload,
    {
      phase: "dormant",
      role: "anchor",
      threadKey: "thread-dormant",
      anchorStateId: dormant.id,
      strength: 0.9,
      reinforcementCount: 4,
      reinforcementSources: ["d1", "d2", "d3", "d4"],
      lastEvolvedAt: now,
      lastReinforcedAt: now,
      dormantAt: now,
    },
  );

  const assembled = assembleTurnContext({
    manifestId: "manifest-thought",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-thought",
    userText: "继续",
    subjectStates: [strong, reinforcement, weak, dormant],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    thoughtLimit: 3,
    thoughtMinStrength: 0.1,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  const thoughtItems = assembled.manifest.items.filter(
    (item) => item.selection.reason === "active_thought",
  );
  assert.deepEqual(
    thoughtItems.map((item) => item.sourceId),
    [strong.id],
  );
  assert.equal(
    assembled.prompt.includes("这个问题一直在我脑子里打转"),
    true,
  );
  assert.equal(
    assembled.prompt.includes("一个已经很弱的念头"),
    false,
  );
  assert.equal(
    assembled.prompt.includes("已经 dormant 的高强度残留也不能进 Context"),
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

test("retired Mind tags cannot hide inside a current authored write", () => {
  const source = "<memory>keep <dream>retired</dream> visible</memory>";
  const parsed = parseMindWriteIntents(source);
  assert.deepEqual(parsed.intents, []);
  assert.equal(parsed.visibleText, source);
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


test("Context Assembly exposes active Curiosity anchors and branch-safe semantic action protocol", () => {
  const curiosity = state(
    "77777777-7777-4777-8777-777777777777",
    "curiosity",
    "这个机制到底为什么会这样",
  );
  curiosity.payload = writeCuriosityEvolution(curiosity.payload, {
    phase: "active",
    role: "anchor",
    threadKey: "curiosity-thread",
    anchorStateId: curiosity.id,
    reinforcementCount: 2,
    reinforcementSources: ["m1", "m2"],
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    resolvedAt: null,
    resolutionSourceId: null,
    dormantAt: null,
  });

  const assembled = assembleTurnContext({
    manifestId: "manifest-curiosity-actions",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-curiosity-actions",
    userText: "我现在把原因讲清楚了",
    subjectStates: [curiosity],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v4",
    breathLimit: 3,
    curiosityLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  assert.equal(
    assembled.manifest.items.some(
      (item) =>
        item.sourceId === curiosity.id
        && item.selection.reason === "active_curiosity"
    ),
    true,
  );
  assert.equal(
    assembled.prompt.includes(
      `<mind_resolve state_id="${curiosity.id}" />`,
    ),
    true,
  );
  assert.equal(
    assembled.prompt.includes("Do not invent state IDs"),
    true,
  );
});

test("Context Assembly injects only active Topic anchors and drops reinforcement copies", () => {
  const anchor = state(
    "99999999-9999-4999-8999-999999999999",
    "topic",
    "下次继续研究 Topic Pool",
  );
  anchor.payload = writeTopicEvolution(anchor.payload, {
    phase: "active",
    role: "anchor",
    threadKey: "topic-thread-active",
    anchorStateId: anchor.id,
    reinforcementCount: 2,
    reinforcementSources: ["m1", "m2"],
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    dormantAt: null,
  });

  const reinforcement = state(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "topic",
    "下次继续研究 Topic Pool",
  );
  reinforcement.payload = writeTopicEvolution(reinforcement.payload, {
    phase: "active",
    role: "reinforcement",
    threadKey: "topic-thread-active",
    anchorStateId: anchor.id,
    reinforcementCount: 2,
    reinforcementSources: ["m1", "m2"],
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    dormantAt: null,
  });

  const dormant = state(
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "topic",
    "已经暂退的话题不应该进 Context",
  );
  dormant.payload = writeTopicEvolution(dormant.payload, {
    phase: "dormant",
    role: "anchor",
    threadKey: "topic-thread-dormant",
    anchorStateId: dormant.id,
    reinforcementCount: 1,
    reinforcementSources: ["m3"],
    lastEvolvedAt: now,
    lastReinforcedAt: now,
    dormantAt: now,
  });

  const assembled = assembleTurnContext({
    manifestId: "manifest-topic",
    userId: "u1",
    subjectId: "G",
    conversation: conversation([], null),
    userMessageId: "u-topic",
    userText: "继续",
    subjectStates: [anchor, reinforcement, dormant],
    snapshotSequence: 1,
    assembledAt: now,
    assemblyVersion: "assembly-v1",
    promptContractVersion: "prompt-v1",
    surfaceLimit: 4,
    breathLimit: 3,
    topicLimit: 3,
    maxContextItems: 10,
    maxContextChars: 4000,
  });

  const topicItems = assembled.manifest.items.filter(
    (item) => item.selection.reason === "active_topic",
  );
  assert.deepEqual(topicItems.map((item) => item.sourceId), [anchor.id]);
  assert.equal(assembled.prompt.includes("下次继续研究 Topic Pool"), true);
  assert.equal(
    assembled.prompt.includes("已经暂退的话题不应该进 Context"),
    false,
  );
});
