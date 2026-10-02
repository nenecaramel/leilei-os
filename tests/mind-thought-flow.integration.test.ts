import assert from "node:assert/strict";
import test from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveMindFollowUps,
  nativeLiveProviderSessionCleanups,
  runtimeContextManifests,
  runtimeSubjectStateTransitions,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  DrizzleNativeLiveMindFollowUpRepository,
  NativeLiveMindFollowUpService,
} from "../src/domains/bridge/mind/native-live-mind-followup.js";
import {
  NativeLiveMindSemanticActionExecutor,
} from "../src/domains/bridge/mind/native-live-mind-semantic-action.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DEFAULT_NATIVE_LIVE_SUBJECT_ID,
  createDefaultBackendMindRuntime,
} from "../src/domains/runtime/mind/default-backend-mind-runtime.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import { readThoughtLifecycle } from "../src/domains/runtime/thought/thought.js";
import { DrizzleThoughtDropPort } from "../src/domains/runtime/thought/thought-runtime-repository.js";

const enabled = process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";

/**
 * The whole rework in one path, against real Postgres and the real
 * coordinator: a thought is written by a tag, becomes visible only after the
 * user continues, is handed to the model as T1 without any database id, is
 * dropped by `<thought_drop ref="T1" />`, and never leaks tags into the
 * visible conversation.
 */
test(
  "a thought is written, shown as T1, and dropped by label across real turns",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    const { db } = database;
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await db
            .delete(nativeLiveMindFollowUps)
            .where(eq(nativeLiveMindFollowUps.userId, userId));
          await db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
          await db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await db
      .insert(users)
      .values({
        email: `mind-thought-flow-${crypto.randomUUID()}@example.com`,
        displayName: "Mind Thought Flow",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Thought flow",
    });

    const turnPort = new DrizzleNativeLiveBackendTurnPort(db);
    const backendMind = createDefaultBackendMindRuntime(db);
    const followUps = new NativeLiveMindFollowUpService(
      new DrizzleNativeLiveMindFollowUpRepository(db),
      turnPort,
      backendMind,
      undefined,
      new NativeLiveMindSemanticActionExecutor(
        new DrizzleSubjectStateRuntimePort(db),
        new DrizzleThoughtDropPort(db),
        DEFAULT_NATIVE_LIVE_SUBJECT_ID,
      ),
    );
    const coordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      followUps,
    );

    async function turn(
      expectedHeadMessageId: string | null,
      userText: string,
      assistantText: string,
    ) {
      const requestId = crypto.randomUUID();
      const prepared = await coordinator.prepare(userId!, {
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversation.id,
        expected_head_message_id: expectedHeadMessageId,
        text: userText,
      });
      assert.equal(prepared.ok, true);
      if (!prepared.ok) throw new Error("expected prepare success");

      const finalized = await coordinator.finalize(userId!, {
        protocol_version: 1,
        prepare_id: prepared.command.prepare_id,
        request_id: requestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: `flow-provider-${crypto.randomUUID()}`,
        normalized_events: [
          { type: "text", payload: { text: assistantText } },
          {
            type: "result",
            payload: { status: "success", final_text: assistantText },
          },
        ],
      });
      assert.equal(finalized.ok, true);
      if (!finalized.ok) throw new Error("expected finalize success");
      return {
        prompt: prepared.command.prompt,
        prepareId: prepared.command.prepare_id,
        assistantMessageId: finalized.assistantMessageId,
      };
    }

    const thoughts = () =>
      db
        .select({
          id: runtimeSubjectStates.id,
          text: runtimeSubjectStates.text,
          payload: runtimeSubjectStates.payload,
          settlementStatus: runtimeSubjectStates.settlementStatus,
          scopeApplicability: runtimeSubjectStates.scopeApplicability,
        })
        .from(runtimeSubjectStates)
        .where(and(
          eq(runtimeSubjectStates.userId, userId!),
          eq(runtimeSubjectStates.kind, "thought"),
        ))
        .orderBy(asc(runtimeSubjectStates.createdAt));

    // Turn 1: the assistant writes a thought.
    const first = await turn(
      null,
      "你好",
      "好呀。<thought>想把 Mind 收简单</thought>",
    );
    assert.equal(/Current thoughts(?: \(rev \d+, supersedes all earlier snapshots\))?:/.test(first.prompt), false);

    const afterFirst = await thoughts();
    assert.equal(afterFirst.length, 1);
    assert.equal(afterFirst[0]?.text, "想把 Mind 收简单");
    assert.equal(
      afterFirst[0]?.settlementStatus,
      "unsettled",
      "a thought stays provisional until the user continues that path",
    );
    assert.equal(afterFirst[0]?.scopeApplicability, "path");
    const thoughtId = afterFirst[0]!.id;

    // The tag never reaches the visible conversation.
    const visible = await conversationService.getConversation({
      userId,
      conversationId: conversation.id,
    });
    const assistantText = visible?.messages
      .find((message) => message.id === first.assistantMessageId)
      ?.blocks.map((block) => block.text ?? "")
      .join("");
    assert.equal(assistantText, "好呀。");

    // Turn 2: the user continues, so the thought settles and is shown as T1.
    const second = await turn(
      first.assistantMessageId,
      "继续",
      '嗯。<thought_drop ref="T1" /><thought>确认主动消息怎么存在</thought>',
    );
    assert.equal(
      /Current thoughts \(rev \d+, supersedes all earlier snapshots\):\n- \[T1\] 想把 Mind 收简单/.test(second.prompt),
      true,
    );
    // Backend context and model instructions are separate inputs. Exercise the
    // actual SDK transport boundary, rather than checking a static prompt constant.
    const { AgentSdkClaudeTransport } = await import("../tools/claude-bridge/src/agent-sdk-claude-transport.mjs");
    let providerInput: { prompt: AsyncIterable<{ message: { content: Array<{ text: string }> } }>; options: { systemPrompt: { append: string } } } | null = null;
    const receivedPrompts: string[] = [];
    const transport = new AgentSdkClaudeTransport({
      environment: {},
      queryImpl: (input: typeof providerInput) => {
        providerInput = input;
        return {
          close() {},
          async *[Symbol.asyncIterator]() {
            assert.ok(input);
            for await (const message of input.prompt) {
              receivedPrompts.push(message.message.content.map(({ text }) => text).join(""));
            }
            yield { type: "result", subtype: "success", session_id: "thought-flow-sdk-fixture", result: "OK" };
          },
        };
      },
    });
    await transport.executeTurn(second.prompt, { mode: "new" });
    assert.ok(providerInput, "the generated context must reach the SDK query");
    assert.deepEqual(receivedPrompts, [second.prompt]);
    assert.equal(
      providerInput.options.systemPrompt.append.includes('<thought_drop ref="T1" />'),
      true,
      "the SDK query offers the drop instruction alongside the generated current T1 context",
    );
    assert.match(providerInput.options.systemPrompt.append, /latest Current thoughts.*authoritative/);

    assert.equal(
      second.prompt.includes(thoughtId),
      false,
      "the model is never handed a database id",
    );

    // The manifest for that turn is the only place the label maps to a state.
    const [manifest] = await db
      .select({ items: runtimeContextManifests.items })
      .from(runtimeContextManifests)
      .where(eq(runtimeContextManifests.id, second.prepareId));
    const labelled = (manifest?.items as Array<Record<string, unknown>>)
      .find((item) => item.alias === "T1");
    assert.equal(labelled?.sourceId, thoughtId);

    // Its follow-up ran after finalize: T1 is dropped by that assistant turn.
    const afterSecond = await thoughts();
    const dropped = afterSecond.find((row) => row.id === thoughtId);
    const lifecycle = readThoughtLifecycle(dropped?.payload);
    assert.equal(lifecycle?.status, "dropped");
    assert.equal(lifecycle?.status === "dropped" && lifecycle.reason, "subject");
    assert.equal(
      lifecycle?.status === "dropped" && lifecycle.droppedByMessageId,
      second.assistantMessageId,
      "the drop records which assistant turn issued it, so Retry can undo it",
    );
    const droppedTransitions = await db
      .select({ reason: runtimeSubjectStateTransitions.reason })
      .from(runtimeSubjectStateTransitions)
      .where(eq(runtimeSubjectStateTransitions.stateId, thoughtId));
    assert.equal(
      droppedTransitions.some(
        (row) => row.reason === "thought_dropped_by_subject",
      ),
      true,
    );
    const newThought = afterSecond.find((row) => row.id !== thoughtId);
    assert.equal(newThought?.text, "确认主动消息怎么存在");

    // Turn 3: only the new thought is shown, and it is T1 now.
    const protectedText = '<drive>旧 <thought>不能入库</thought><thought_drop ref="T1" /></drive>';
    const third = await turn(second.assistantMessageId, "好", protectedText);
    assert.equal(
      /Current thoughts \(rev \d+, supersedes all earlier snapshots\):\n- \[T1\] 确认主动消息怎么存在/.test(third.prompt),
      true,
    );
    assert.equal(third.prompt.includes("想把 Mind 收简单"), false);

    // The canonical response preserves the wrapper and neither writes nor drops.
    const afterThird = await thoughts();
    assert.deepEqual(
      afterThird.map(({ id, text }) => ({ id, text })),
      afterSecond.map(({ id, text }) => ({ id, text })),
    );
    assert.equal(
      readThoughtLifecycle(afterThird.find((row) => row.id === newThought?.id)?.payload)?.status,
      "active",
    );
    const transitions = await db
      .select({ reason: runtimeSubjectStateTransitions.reason })
      .from(runtimeSubjectStateTransitions)
      .where(eq(runtimeSubjectStateTransitions.stateId, newThought!.id));
    assert.equal(transitions.some(({ reason }) => reason === "thought_dropped_by_subject"), false);
    const afterProtectedTurn = await conversationService.getConversation({
      userId, conversationId: conversation.id,
    });
    assert.equal(
      afterProtectedTurn?.messages
        .find((message) => message.id === third.assistantMessageId)
        ?.blocks.map((block) => block.text ?? "").join(""),
      protectedText,
    );
  },
);

test(
  "Retry and Edit see the thought the replaced turn dropped, and get it back after finalize",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    const { db } = database;
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await db
            .delete(nativeLiveMindFollowUps)
            .where(eq(nativeLiveMindFollowUps.userId, userId));
          await db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
          await db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await db
      .insert(users)
      .values({
        email: `mind-thought-retry-${crypto.randomUUID()}@example.com`,
        displayName: "Mind Thought Retry",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Thought retry",
    });
    const turnPort = new DrizzleNativeLiveBackendTurnPort(db);
    const backendMind = createDefaultBackendMindRuntime(db);
    const coordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      new NativeLiveMindFollowUpService(
        new DrizzleNativeLiveMindFollowUpRepository(db),
        turnPort,
        backendMind,
        undefined,
        new NativeLiveMindSemanticActionExecutor(
          new DrizzleSubjectStateRuntimePort(db),
          new DrizzleThoughtDropPort(db),
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
        ),
      ),
    );

    async function run(
      body: Record<string, unknown>,
      assistantText: string,
    ) {
      const requestId = crypto.randomUUID();
      const prepared = await coordinator.prepare(userId!, {
        dispatch_target: "claude_code",
        request_id: requestId,
        conversation_id: conversation.id,
        ...body,
      } as never);
      assert.equal(prepared.ok, true);
      if (!prepared.ok) throw new Error("expected prepare success");
      const finalized = await coordinator.finalize(userId!, {
        protocol_version: 1,
        prepare_id: prepared.command.prepare_id,
        request_id: requestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: `retry-provider-${crypto.randomUUID()}`,
        normalized_events: [
          { type: "text", payload: { text: assistantText } },
          {
            type: "result",
            payload: { status: "success", final_text: assistantText },
          },
        ],
      });
      assert.equal(finalized.ok, true);
      if (!finalized.ok) throw new Error("expected finalize success");
      return {
        prompt: prepared.command.prompt,
        assistantMessageId: finalized.assistantMessageId,
      };
    }

    const thoughts = () =>
      db
        .select({
          id: runtimeSubjectStates.id,
          text: runtimeSubjectStates.text,
          payload: runtimeSubjectStates.payload,
        })
        .from(runtimeSubjectStates)
        .where(and(
          eq(runtimeSubjectStates.userId, userId!),
          eq(runtimeSubjectStates.kind, "thought"),
        ))
        .orderBy(asc(runtimeSubjectStates.createdAt));
    const statusOf = async (text: string) => {
      const row = (await thoughts()).find((item) => item.text === text);
      return row ? readThoughtLifecycle(row.payload)?.status ?? null : null;
    };

    const first = await run(
      { operation: "send", expected_head_message_id: null, text: "你好" },
      "好呀。<thought>想把 Mind 收简单</thought>",
    );
    const second = await run(
      {
        operation: "send",
        expected_head_message_id: first.assistantMessageId,
        text: "继续",
      },
      '嗯。<thought_drop ref="T1" /><thought>只在被替换的那一轮出现</thought>',
    );
    assert.equal(await statusOf("想把 Mind 收简单"), "dropped");
    assert.equal(
      await statusOf("只在被替换的那一轮出现"),
      "active",
      "written by the turn that is about to be replaced",
    );

    const secondUserId = (await conversationService.getConversation({
      userId,
      conversationId: conversation.id,
    }))?.messages.find(
      (message) => message.id === second.assistantMessageId,
    )?.parentMessageId;
    assert.ok(secondUserId);

    // RETRY: the model must see T1 exactly as the replaced turn did...
    const retry = await run(
      { operation: "retry", target_user_message_id: secondUserId },
      "换个说法。",
    );
    assert.equal(
      /Current thoughts \(rev \d+, supersedes all earlier snapshots\):\n- \[T1\] 想把 Mind 收简单/.test(retry.prompt),
      true,
      "the retried generation sees the thought the old attempt dropped",
    );
    assert.equal(
      retry.prompt.includes("只在被替换的那一轮出现"),
      false,
      "and not what only the old attempt wrote",
    );
    // ...and afterwards the world is as if the old attempt never happened.
    assert.equal(await statusOf("想把 Mind 收简单"), "active");
    assert.equal(await statusOf("只在被替换的那一轮出现"), null);

    // EDIT of the same user message behaves the same way.
    const retryReplyDropped = await run(
      { operation: "edit", target_user_message_id: secondUserId, text: "继续，改一下" },
      '好。<thought_drop ref="T1" />',
    );
    assert.equal(await statusOf("想把 Mind 收简单"), "dropped");
    const editedUserId = (await conversationService.getConversation({
      userId,
      conversationId: conversation.id,
    }))?.messages.find(
      (message) => message.id === retryReplyDropped.assistantMessageId,
    )?.parentMessageId;
    assert.ok(editedUserId);
    const editAgain = await run(
      { operation: "edit", target_user_message_id: editedUserId, text: "再改一次" },
      "行。",
    );
    assert.equal(
      /Current thoughts \(rev \d+, supersedes all earlier snapshots\):\n- \[T1\] 想把 Mind 收简单/.test(editAgain.prompt),
      true,
    );
    assert.equal(await statusOf("想把 Mind 收简单"), "active");
  },
);

test(
  "retired tags in a real turn stay visible in the conversation and create no Mind state",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    const { db } = database;
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await db
            .delete(nativeLiveMindFollowUps)
            .where(eq(nativeLiveMindFollowUps.userId, userId));
          await db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
          await db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await db
      .insert(users)
      .values({
        email: `mind-retired-tags-${crypto.randomUUID()}@example.com`,
        displayName: "Mind Retired Tags",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Retired tags",
    });
    const turnPort = new DrizzleNativeLiveBackendTurnPort(db);
    const backendMind = createDefaultBackendMindRuntime(db);
    const coordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      new NativeLiveMindFollowUpService(
        new DrizzleNativeLiveMindFollowUpRepository(db),
        turnPort,
        backendMind,
        undefined,
        new NativeLiveMindSemanticActionExecutor(
          new DrizzleSubjectStateRuntimePort(db),
          new DrizzleThoughtDropPort(db),
          DEFAULT_NATIVE_LIVE_SUBJECT_ID,
        ),
      ),
    );

    const requestId = crypto.randomUUID();
    const reply =
      "好。<drive>还想继续</drive><curiosity>为什么</curiosity>"
      + '<topic>下次</topic><mind_satisfy state_id="55555555-5555-4555-8555-555555555555" level="full" />';
    const prepared = await coordinator.prepare(userId, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "你好",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("expected prepare success");
    const finalized = await coordinator.finalize(userId, {
      protocol_version: 1,
      prepare_id: prepared.command.prepare_id,
      request_id: requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: `retired-provider-${crypto.randomUUID()}`,
      normalized_events: [
        { type: "text", payload: { text: reply } },
        { type: "result", payload: { status: "success", final_text: reply } },
      ],
    });
    assert.equal(finalized.ok, true);
    if (!finalized.ok) throw new Error("expected finalize success");

    const visible = (await conversationService.getConversation({
      userId,
      conversationId: conversation.id,
    }))?.messages
      .find((message) => message.id === finalized.assistantMessageId)
      ?.blocks.map((block) => block.text ?? "")
      .join("");
    assert.equal(visible, reply, "nothing is stripped or reinterpreted");

    const states = await db
      .select({ id: runtimeSubjectStates.id })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    assert.equal(states.length, 0, "no Mind state was created");
  },
);
