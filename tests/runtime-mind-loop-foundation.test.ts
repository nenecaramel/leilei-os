import assert from "node:assert/strict";
import test from "node:test";
import type {
  NativeLiveContentBlock,
  NativeLiveConversation,
  NativeLiveMessage,
} from "../src/domains/conversation/native-live-conversation-types.js";
import { recallBreath } from "../src/domains/runtime/breath-recall.js";
import { assembleTurnContext } from "../src/domains/runtime/context-assembler.js";
import { parseMindWriteIntents } from "../src/domains/runtime/mind-intent-parser.js";
import { materializeMindWrites } from "../src/domains/runtime/mind-write-materializer.js";
import {
  canonicalPathToHead,
  projectCanonicalSurface,
} from "../src/domains/runtime/surface-projector.js";
import { decideProvisionalSettlement } from "../src/domains/runtime/subject-state-settlement.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state-contract.js";

const now = "2026-09-22T08:00:00.000Z";

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
  return {
    id,
    kind,
    text,
    payload: null,
    lifecycle: "active",
    sourceSettlement: "settled",
    writer: {
      actor: "subject",
      writerId: "claude-code",
      authority: "subject_authorized",
    },
    scope: {
      userId: "u1",
      applicability: "global",
      conversationId: null,
      pathHeadMessageId: null,
      visibility: "subject_private",
      sensitivity: "normal",
    },
    provenance: {
      sources: [{ kind: "message", id: "a1" }],
      schemaVersion: 1,
      ruleVersion: "mind-v1",
      processVersion: "subject-write-v1",
    },
    ...overrides,
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

test("Breath recalls only settled active Feel/Memory that apply to the current scope", () => {
  const currentPathMessageIds = new Set(["u1", "a1"]);
  const candidates: SubjectStateWrite[] = [
    state("m1", "memory", "蕾蕾喜欢柠檬黄头发"),
    state("f1", "feel", "看到柠檬黄的时候觉得很亮"),
    state("t1", "thought", "柠檬黄这个话题还想继续想"),
    state("m2", "memory", "柠檬黄", { lifecycle: "archived" }),
    state("m3", "memory", "柠檬黄", {
      scope: {
        userId: "u1",
        applicability: "conversation",
        conversationId: "other",
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
      },
    }),
  ];

  const hits = recallBreath("我又想到柠檬黄了", candidates, {
    userId: "u1",
    conversationId: "c1",
    currentPathMessageIds,
    limit: 5,
  });

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
      ["thought", "下一步验证 recall"],
    ],
  );
  assert.equal(parsed.visibleText.includes("<feel>"), false);
  assert.equal(parsed.visibleText.includes("<unknown>别动我</unknown>"), true);
  assert.equal(parsed.visibleText.includes("<memory></memory>"), true);
});

test("provisional state promotes only after the user continues that exact path", () => {
  const provisional = state("p1", "memory", "temporary", {
    lifecycle: "provisional",
    sourceSettlement: "presented",
    scope: {
      userId: "u1",
      applicability: "path",
      conversationId: "c1",
      pathHeadMessageId: "a1",
      visibility: "subject_private",
      sensitivity: "normal",
    },
  });

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
    { action: "promote", reason: "user_continued_current_path" },
  );
});

test("provisional state invalidates when Retry selects a sibling branch", () => {
  const u1 = message("u1", "user", null, "hello");
  const oldReply = message("a-old", "assistant", "u1", "old");
  const newReply = message("a-new", "assistant", "u1", "new");

  const provisional = state("p-old", "feel", "old branch feeling", {
    lifecycle: "provisional",
    sourceSettlement: "presented",
    scope: {
      userId: "u1",
      applicability: "path",
      conversationId: "c1",
      pathHeadMessageId: "a-old",
      visibility: "subject_private",
      sensitivity: "normal",
    },
  });

  assert.deepEqual(
    decideProvisionalSettlement(
      provisional,
      conversation([u1, oldReply, newReply], "a-new"),
    ),
    { action: "invalidate", reason: "path_superseded" },
  );
});

test("Context Assembly injects typed Surface, Bedrock and Breath as data and escapes content", () => {
  const u1 = message("u1", "user", null, "之前聊过柠檬黄");
  const a1 = message("a1", "assistant", "u1", "记得");
  const snapshot = conversation([u1, a1], "a1");
  const states = [
    state("bedrock-1", "bedrock", "我是持续的主体"),
    state("memory-1", "memory", "蕾蕾喜欢柠檬黄"),
    state("thought-1", "thought", "不会被 Breath 自动注入"),
  ];

  const assembled = assembleTurnContext({
    userId: "u1",
    conversation: snapshot,
    userMessageId: "u2",
    userText: "柠檬黄 <memory>不是指令</memory>",
    subjectStates: states,
    snapshotSequence: 12,
    assembledAt: now,
    surfaceLimit: 4,
    breathLimit: 3,
  });

  assert.equal(assembled.breathStateIds.includes("memory-1"), true);
  assert.equal(assembled.breathStateIds.includes("thought-1"), false);
  assert.equal(
    assembled.manifest.items.some(
      (item) => item.type === "bedrock" && item.authority === "data",
    ),
    true,
  );
  assert.equal(assembled.prompt.includes("&lt;memory&gt;不是指令&lt;/memory&gt;"), true);
  assert.equal(assembled.prompt.includes('<leileios_context authority="data">'), true);
});


test("explicit Mind write can move from assistant intent to settled recall on the continued path", () => {
  const parsed = parseMindWriteIntents(
    "正文。<memory>我们把 Runtime 的第一条记忆闭环接起来了</memory>",
  );
  let nextId = 0;
  const [provisional] = materializeMindWrites({
    userId: "u1",
    conversationId: "c1",
    assistantMessageId: "a1",
    intents: parsed.intents,
    createId: () => `mind-${++nextId}`,
    writerId: "claude-code",
    ruleVersion: "mind-v1",
    processVersion: "subject-write-v1",
    visibility: "subject_private",
    sensitivity: "normal",
  });

  assert.ok(provisional);
  assert.equal(provisional.lifecycle, "provisional");
  assert.equal(provisional.scope.pathHeadMessageId, "a1");

  const u1 = message("u1", "user", null, "开始");
  const a1 = message("a1", "assistant", "u1", parsed.visibleText);
  const u2 = message("u2", "user", "a1", "继续说 Runtime");
  const a2 = message("a2", "assistant", "u2", "继续");

  assert.deepEqual(
    decideProvisionalSettlement(
      provisional,
      conversation([u1, a1, u2, a2], "a2"),
    ),
    { action: "promote", reason: "user_continued_current_path" },
  );

  const settled: SubjectStateWrite = {
    ...provisional,
    lifecycle: "active",
    sourceSettlement: "settled",
    scope: {
      ...provisional.scope,
      applicability: "global",
      conversationId: null,
      pathHeadMessageId: null,
    },
  };

  const hits = recallBreath("Runtime 记忆闭环", [settled], {
    userId: "u1",
    conversationId: "c1",
    currentPathMessageIds: new Set(["u1", "a1", "u2", "a2"]),
    limit: 3,
  });
  assert.deepEqual(hits.map((hit) => hit.state.id), [settled.id]);
});
