import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  CuriosityTopicProjectionService,
  curiosityTopicStateId,
} from "../src/domains/runtime/curiosity-topic-projection.js";
import {
  DrizzleCuriosityTopicProjectionRuntimePort,
} from "../src/domains/runtime/curiosity-topic-projection-runtime-repository.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  DrizzleTopicEvolutionRuntimePort,
} from "../src/domains/runtime/topic-evolution-runtime-repository.js";
import {
  TopicEvolutionService,
  readTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_TOPIC_DATABASE_TEST === "1";

function curiosityState(input: {
  id: string;
  userId: string;
  text: string;
  sourceId: string;
  settled: boolean;
}): SubjectStateWrite {
  return {
    id: input.id,
    kind: "curiosity",
    text: input.text,
    payload: null,
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: input.settled
        ? {
            userId: input.userId,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          }
        : {
            userId: input.userId,
            subjectId: "G",
            applicability: "path",
            conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            pathHeadMessageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: input.settled ? "settled" : "unsettled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "message", id: input.sourceId }],
        causedBy: input.sourceId,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "curiosity-test",
        processVersion: "curiosity-test",
        model: null,
      },
    },
  };
}

test(
  "settled Curiosity projects idempotently into a derived Topic and provisional Curiosity does not",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `runtime-curiosity-topic-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Curiosity Topic",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const subjectStates = new DrizzleSubjectStateRuntimePort(database.db);
    const settledId = "11111111-1111-4111-8111-111111111111";
    const provisionalId = "22222222-2222-4222-8222-222222222222";
    await subjectStates.append({
      userId,
      subjectId: "G",
      states: [
        curiosityState({
          id: settledId,
          userId,
          text: "为什么 dormant Topic 会重新活跃",
          sourceId: "assistant-message-1",
          settled: true,
        }),
        curiosityState({
          id: provisionalId,
          userId,
          text: "这条还在未确认分支",
          sourceId: "assistant-message-2",
          settled: false,
        }),
      ],
    });

    const projection = new CuriosityTopicProjectionService(
      new DrizzleCuriosityTopicProjectionRuntimePort(database.db),
    );
    const first = await projection.runOnce({
      userId,
      subjectId: "G",
      now: new Date().toISOString(),
    });
    const second = await projection.runOnce({
      userId,
      subjectId: "G",
      now: new Date().toISOString(),
    });

    assert.equal(first.scanned, 1);
    assert.equal(first.projected, 1);
    assert.equal(second.projected, 1);

    const rows = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const derivedId = curiosityTopicStateId(settledId);
    const topics = rows.filter((state) => state.kind === "topic");
    assert.equal(topics.length, 1);
    const [topic] = topics;
    assert.ok(topic);
    assert.equal(topic.id, derivedId);
    assert.equal(topic.envelope.authority, "derived");
    assert.equal(
      topic.envelope.provenance.causedBy,
      "assistant-message-1",
    );
    assert.deepEqual(
      topic.envelope.provenance.derivedFrom,
      [settledId],
    );
    assert.equal(
      rows.some(
        (state) =>
          state.kind === "topic"
          && state.text === "这条还在未确认分支",
      ),
      false,
    );

    const evolution = new TopicEvolutionService(
      new DrizzleTopicEvolutionRuntimePort(database.db),
      {
        maxReinforcementSources: 16,
        dormantAfterHours: 168,
      },
    );
    await evolution.runOnce({
      userId,
      subjectId: "G",
      now: new Date().toISOString(),
    });

    const evolved = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const activeTopic = evolved.find((state) => state.id === derivedId);
    assert.ok(activeTopic);
    assert.equal(readTopicEvolution(activeTopic.payload)?.phase, "active");
  },
);
