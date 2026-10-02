import assert from "node:assert/strict";
import test from "node:test";
import { and, asc, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations as conversationRows,
  productCreateIdempotency,
  runtimeContextManifests,
  runtimeSubjectStateTransitions,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import type { InitialContextManifest } from "../src/domains/runtime/context/context-invocation-contract.js";
import { createMindState } from "../src/domains/runtime/mind/mind-writer.js";
import { DrizzleMindProductRepository } from "../src/domains/runtime/mind/mind-product-repository.js";
import { MindProductService } from "../src/domains/runtime/mind/mind-product-service.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state/subject-state-runtime-repository.js";
import {
  THOUGHT_ACTIVE_LIMIT,
  readThoughtLifecycle,
  writeThoughtActive,
  writeThoughtDropped,
} from "../src/domains/runtime/thought/thought.js";
import {
  DrizzleThoughtDropPort,
  enforceThoughtCapacity,
} from "../src/domains/runtime/thought/thought-runtime-repository.js";

const enabled = process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";
const SUBJECT = "G";

async function fixture(t: import("node:test").TestContext) {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const database = createDatabase(databaseUrl, { ssl: false });
  const { db } = database;

  let userId: string | null = null;
  t.after(async () => {
    try {
      if (userId) {
        await db
          .delete(productCreateIdempotency)
          .where(eq(productCreateIdempotency.userId, userId));
        await db
          .delete(runtimeContextManifests)
          .where(eq(runtimeContextManifests.userId, userId));
        await db
          .delete(runtimeSubjectStates)
          .where(eq(runtimeSubjectStates.userId, userId));
        await db
          .delete(conversationRows)
          .where(eq(conversationRows.userId, userId));
        await db.delete(users).where(eq(users.id, userId));
      }
    } finally {
      await database.close();
    }
  });

  const [user] = await db
    .insert(users)
    .values({
      email: `thought-${crypto.randomUUID()}@example.com`,
      displayName: "Thought DB Test",
    })
    .returning({ id: users.id });
  assert.ok(user);
  userId = user.id;

  const conversations = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(db),
  );
  const conversation = await conversations.createConversation({
    userId: user.id,
    title: "Thought test",
  });

  // A chain of user/assistant turns; each assistant message can carry writes.
  let parent: string | null = null;
  const assistants: string[] = [];
  const turn = async (n: number) => {
    const userMessage = await conversations.appendUserMessage({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: parent,
      blocks: [{ kind: "text", rawType: "text", text: `u${n}` }],
    });
    const assistant = await conversations.completeAssistantTurn({
      userId: user.id,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", rawType: "text", text: `a${n}` }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: `thought-${crypto.randomUUID()}`,
      },
    });
    parent = assistant.message.id;
    assistants.push(assistant.message.id);
    return assistant.message.id;
  };

  const port = new DrizzleSubjectStateRuntimePort(db);

  /** A thought written by the assistant on `assistantId`, path-scoped. */
  const writeThought = async (assistantId: string, text: string) => {
    const state = createMindState({
      id: crypto.randomUUID(),
      userId: user.id,
      subjectId: SUBJECT,
      kind: "thought",
      text,
      source: {
        origin: "assistant",
        conversationId: conversation.id,
        assistantMessageId: assistantId,
        occurredAt: new Date().toISOString(),
        span: { start: 0, end: 1 },
        producer: { kind: "model", id: "claude-code" },
        committer: { kind: "runtime", id: "leileios-runtime" },
        status: {
          generationStatus: "committed",
          presentationStatus: "presented",
          pathStatus: "current",
          settlementStatus: "unsettled",
          validityStatus: "valid",
        },
        visibility: "subject_private",
        sensitivity: "normal",
        audience: [SUBJECT],
        ruleVersion: "mind-v2",
        processVersion: "subject-write-v2",
      },
    });
    await port.append({
      userId: user.id,
      subjectId: SUBJECT,
      states: [state],
      sourceConversationId: conversation.id,
    });
    return state.id;
  };

  const settle = (stateId: string) =>
    port.transition({
      userId: user.id,
      subjectId: SUBJECT,
      conversationId: conversation.id,
      transitions: [{
        stateId,
        stateKind: "thought",
        reason: "user_continued_current_path",
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        promoteScopeToGlobal: true,
      }],
    });

  const thoughtRows = async () =>
    db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
      })
      .from(runtimeSubjectStates)
      .where(and(
        eq(runtimeSubjectStates.userId, user.id),
        eq(runtimeSubjectStates.kind, "thought"),
      ))
      .orderBy(
        asc(runtimeSubjectStates.createdAt),
        asc(runtimeSubjectStates.id),
      );

  const transitionReasons = async (stateId: string) =>
    (await db
      .select({ reason: runtimeSubjectStateTransitions.reason })
      .from(runtimeSubjectStateTransitions)
      .where(eq(runtimeSubjectStateTransitions.stateId, stateId))
      .orderBy(asc(runtimeSubjectStateTransitions.createdAt)))
      .map((row) => row.reason);

  return {
    db,
    userId: user.id,
    conversationId: conversation.id,
    port,
    turn,
    writeThought,
    settle,
    thoughtRows,
    transitionReasons,
  };
}

test(
  "settling thoughts keeps at most the active limit, dropping the oldest with a recorded reason",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const ids: string[] = [];
    for (let n = 1; n <= 5; n += 1) {
      const assistantId = await f.turn(n);
      const id = await f.writeThought(assistantId, `thought ${n}`);
      ids.push(id);
      await f.settle(id);

      const active = (await f.thoughtRows()).filter(
        (row) => readThoughtLifecycle(row.payload)?.status === "active",
      );
      assert.equal(
        active.length,
        Math.min(n, THOUGHT_ACTIVE_LIMIT),
        `after settling thought ${n}`,
      );
    }

    const rows = await f.thoughtRows();
    assert.equal(rows.length, 5, "nothing is ever physically deleted");
    const byId = new Map(rows.map((row) => [row.id, row]));

    assert.deepEqual(
      ids.map((id) => readThoughtLifecycle(byId.get(id)!.payload)?.status),
      ["dropped", "dropped", "active", "active", "active"],
    );
    const first = readThoughtLifecycle(byId.get(ids[0]!)!.payload);
    assert.equal(first?.status === "dropped" && first.reason, "capacity");
    assert.equal(
      first?.status === "dropped" && first.droppedByMessageId,
      null,
    );
    assert.equal(
      (await f.transitionReasons(ids[0]!)).includes(
        "thought_dropped_capacity",
      ),
      true,
    );
    assert.equal(
      (await f.transitionReasons(ids[4]!)).includes(
        "thought_dropped_capacity",
      ),
      false,
    );
  },
);

test(
  "an unsettled thought does not count toward the limit and does not displace anything",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const settled: string[] = [];
    for (let n = 1; n <= 3; n += 1) {
      const id = await f.writeThought(await f.turn(n), `settled ${n}`);
      await f.settle(id);
      settled.push(id);
    }
    // A fourth thought is written on a turn the user has not continued yet.
    await f.writeThought(await f.turn(4), "still provisional");

    const rows = await f.thoughtRows();
    const active = rows.filter(
      (row) => readThoughtLifecycle(row.payload)?.status === "active",
    );
    assert.equal(active.length, 4);
    assert.deepEqual(
      settled.map((id) =>
        readThoughtLifecycle(rows.find((row) => row.id === id)!.payload)
          ?.status
      ),
      ["active", "active", "active"],
    );
  },
);

test(
  "the subject can drop a thought once; replays are idempotent and unknown or unsettled ids are rejected",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const assistantId = await f.turn(1);
    const id = await f.writeThought(assistantId, "let this go");
    const dropPort = new DrizzleThoughtDropPort(f.db);
    const input = {
      userId: f.userId,
      subjectId: SUBJECT,
      stateId: id,
      droppedAt: "2026-09-30T00:00:00.000Z",
      droppedByMessageId: assistantId,
    };

    // Not yet settled: the model could not have seen it, so it is refused.
    assert.deepEqual(await dropPort.dropThought(input), {
      outcome: "rejected",
      code: "THOUGHT_NOT_SETTLED",
    });

    await f.settle(id);
    assert.deepEqual(await dropPort.dropThought(input), {
      outcome: "applied",
    });
    assert.deepEqual(await dropPort.dropThought(input), {
      outcome: "idempotent",
    });
    assert.deepEqual(
      await dropPort.dropThought({
        ...input,
        stateId: crypto.randomUUID(),
      }),
      { outcome: "rejected", code: "THOUGHT_NOT_FOUND" },
    );

    const [row] = await f.thoughtRows();
    assert.deepEqual(readThoughtLifecycle(row!.payload), {
      status: "dropped",
      reason: "subject",
      droppedAt: "2026-09-30T00:00:00.000Z",
      droppedByMessageId: assistantId,
    });
    const reasons = await f.transitionReasons(id);
    assert.equal(
      reasons.filter((reason) => reason === "thought_dropped_by_subject")
        .length,
      1,
    );
  },
);

test(
  "a manually added thought is settled at once and displaces the oldest at the limit",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const service = new MindProductService(
      new DrizzleMindProductRepository(f.db),
      SUBJECT,
    );

    const created: string[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const item = await service.createManual({
        userId: f.userId,
        kind: "thought",
        text: `manual ${n}`,
        idempotencyKey: `manual-thought-create-${n}-${crypto.randomUUID()}`,
      });
      created.push(item.id);
    }

    const rows = await f.thoughtRows();
    assert.deepEqual(
      created.map((id) =>
        readThoughtLifecycle(rows.find((row) => row.id === id)!.payload)
          ?.status
      ),
      ["dropped", "active", "active", "active"],
    );
    assert.equal(
      (await f.transitionReasons(created[0]!)).includes(
        "thought_dropped_capacity",
      ),
      true,
    );
  },
);

test(
  "reviving a thought re-applies the limit instead of exceeding it",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const ids: string[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const id = await f.writeThought(await f.turn(n), `thought ${n}`);
      await f.settle(id);
      ids.push(id);
    }
    // Thought 1 was displaced. Suppose a purge revives thought 2's sibling.
    await f.db
      .update(runtimeSubjectStates)
      .set({ payload: writeThoughtActive(null) })
      .where(eq(runtimeSubjectStates.id, ids[0]!));

    await f.db.transaction((transaction) =>
      enforceThoughtCapacity(transaction, {
        userId: f.userId,
        subjectId: SUBJECT,
        droppedAt: new Date().toISOString(),
      })
    );

    const rows = await f.thoughtRows();
    const statuses = ids.map((id) =>
      readThoughtLifecycle(rows.find((row) => row.id === id)!.payload)
        ?.status
    );
    // Four active would exceed the limit; the oldest is displaced again.
    assert.deepEqual(statuses, ["dropped", "active", "active", "active"]);
  },
);

test(
  "a stored Context Manifest keeps thought labels so a drop can be resolved later",
  { skip: !enabled },
  async (t) => {
    const f = await fixture(t);
    const assistantId = await f.turn(1);
    const thoughtId = await f.writeThought(assistantId, "labelled");
    await f.settle(thoughtId);

    const manifestId = crypto.randomUUID();
    const manifest: InitialContextManifest = {
      manifestId,
      userId: f.userId,
      subjectId: SUBJECT,
      conversationId: f.conversationId,
      pathHeadMessageId: assistantId,
      snapshotSequence: 2,
      assemblyVersion: "assembly-v2",
      promptContractVersion: "prompt-v5",
      createdAt: new Date().toISOString(),
      budget: {
        maxItems: 16,
        maxChars: 8000,
        usedItems: 1,
        usedChars: 8,
        overflowPolicy: "drop_lowest_rank",
      },
      items: [{
        id: `subject-state:${thoughtId}`,
        type: "thought",
        sourceId: thoughtId,
        authority: "data",
        trustBoundary: "subject_state_data",
        text: "labelled",
        alias: "T1",
        selection: { reason: "active_thought", rank: 150, truncated: false },
      }],
    };

    await f.port.saveContextManifest({ manifest });
    // Saving the same manifest again is an idempotent replay.
    await f.port.saveContextManifest({ manifest });

    const loaded = await f.port.loadContextManifest({
      userId: f.userId,
      subjectId: SUBJECT,
      manifestId,
    });
    assert.equal(loaded?.items[0]?.alias, "T1");
    assert.equal(loaded?.items[0]?.sourceId, thoughtId);

    // Dropped-thought payloads round-trip through jsonb unchanged.
    const dropped = writeThoughtDropped(null, {
      reason: "capacity",
      droppedAt: "2026-09-30T00:00:00.000Z",
    });
    assert.deepEqual(readThoughtLifecycle(dropped)?.status, "dropped");
  },
);
