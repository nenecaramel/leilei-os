import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
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

function topicState(input: {
  id: string;
  userId: string;
  text: string;
  sourceId: string;
  settled?: boolean;
}): SubjectStateWrite {
  const settled = input.settled ?? true;
  return {
    id: input.id,
    kind: "topic",
    text: input.text,
    payload: null,
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "derived",
      scope: settled
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
            conversationId: "11111111-1111-4111-8111-111111111111",
            pathHeadMessageId: "22222222-2222-4222-8222-222222222222",
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: settled ? "settled" : "unsettled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "message", id: input.sourceId }],
        causedBy: input.sourceId,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "topic-test",
        processVersion: "topic-test",
      },
    },
  };
}

test(
  "Topic evolution persists only settled current valid seeds and is replay-stable",
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
        email: `runtime-topic-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Topic",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const statePort = new DrizzleSubjectStateRuntimePort(database.db);
    const anchorId = crypto.randomUUID();
    const reinforcementId = crypto.randomUUID();
    const provisionalId = crypto.randomUUID();
    await statePort.append({
      userId,
      subjectId: "G",
      states: [
        topicState({
          id: anchorId,
          userId,
          text: "Continue exploring Topic Pool",
          sourceId: "topic-source-1",
        }),
        topicState({
          id: reinforcementId,
          userId,
          text: "  CONTINUE EXPLORING TOPIC POOL  ",
          sourceId: "topic-source-2",
        }),
        topicState({
          id: provisionalId,
          userId,
          text: "Continue exploring Topic Pool",
          sourceId: "topic-source-unsettled",
          settled: false,
        }),
      ],
    });

    const service = new TopicEvolutionService(
      new DrizzleTopicEvolutionRuntimePort(database.db),
      {
        maxReinforcementSources: 16,
        dormantAfterHours: 168,
      },
    );
    const first = await service.runOnce({
      userId,
      subjectId: "G",
      now: new Date().toISOString(),
    });

    assert.equal(first.scanned, 2);
    assert.equal(first.threads, 1);
    assert.equal(first.applied, 2);
    assert.equal(first.conflicts, 0);

    const rows = await statePort.list({
      userId,
      subjectId: "G",
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
    const anchor = rows.find(
      (state) => readTopicEvolution(state.payload)?.role === "anchor",
    );
    assert.ok(anchor);
    const topic = readTopicEvolution(anchor.payload);
    assert.ok(topic);
    assert.equal(topic.role, "anchor");
    assert.equal(topic.reinforcementCount, 2);

    const provisional = rows.find((state) => state.id === provisionalId);
    assert.ok(provisional);
    assert.equal(readTopicEvolution(provisional.payload), null);

    const second = await service.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(second.applied, 0);
    assert.equal(second.conflicts, 0);

    const dormantRun = await service.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 8 * 24 * 3_600_000).toISOString(),
    });
    assert.equal(dormantRun.dormant, 1);
    assert.equal(dormantRun.conflicts, 0);

    const afterDormancy = await statePort.list({
      userId,
      subjectId: "G",
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
    const dormantAnchor = afterDormancy.find((state) => state.id === anchorId);
    assert.ok(dormantAnchor);
    assert.equal(readTopicEvolution(dormantAnchor.payload)?.phase, "dormant");
  },
);
