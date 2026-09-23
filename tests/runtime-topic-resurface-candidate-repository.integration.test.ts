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
  DrizzleTopicResurfaceCandidatePort,
} from "../src/domains/runtime/topic-resurface-candidate-runtime-repository.js";
import {
  TopicResurfaceCandidateService,
} from "../src/domains/runtime/topic-resurface-candidates.js";
import {
  topicThreadKey,
  writeTopicEvolution,
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
  phase: "active" | "dormant";
  role?: "anchor" | "reinforcement";
  settled?: boolean;
}): SubjectStateWrite {
  const settled = input.settled ?? true;
  const dormantAt =
    input.phase === "dormant"
      ? "2026-09-30T00:00:00.000Z"
      : null;
  return {
    id: input.id,
    kind: "topic",
    text: input.text,
    payload: writeTopicEvolution(null, {
      phase: input.phase,
      role: input.role ?? "anchor",
      threadKey: topicThreadKey(input.text),
      anchorStateId: input.id,
      reinforcementCount: 1,
      reinforcementSources: [`source-${input.id}`],
      lastEvolvedAt: "2026-09-30T00:00:00.000Z",
      lastReinforcedAt: "2026-09-23T00:00:00.000Z",
      dormantAt,
    }),
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
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
        sources: [{ kind: "message", id: `source-${input.id}` }],
        causedBy: `source-${input.id}`,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "topic-resurface-test",
        processVersion: "topic-resurface-test",
        model: null,
      },
    },
  };
}

test(
  "Topic resurface repository exposes only settled global dormant anchors",
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
        email: `runtime-topic-resurface-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Topic Resurface",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const dormantAnchor = topicState({
      id: crypto.randomUUID(),
      userId,
      text: "Dormant anchor",
      phase: "dormant",
    });
    const activeAnchor = topicState({
      id: crypto.randomUUID(),
      userId,
      text: "Active anchor",
      phase: "active",
    });
    const dormantReinforcement = topicState({
      id: crypto.randomUUID(),
      userId,
      text: "Dormant reinforcement",
      phase: "dormant",
      role: "reinforcement",
    });
    const provisionalDormant = topicState({
      id: crypto.randomUUID(),
      userId,
      text: "Provisional dormant",
      phase: "dormant",
      settled: false,
    });

    await new DrizzleSubjectStateRuntimePort(database.db).append({
      userId,
      subjectId: "G",
      states: [
        dormantAnchor,
        activeAnchor,
        dormantReinforcement,
        provisionalDormant,
      ],
    });

    const service = new TopicResurfaceCandidateService(
      new DrizzleTopicResurfaceCandidatePort(database.db),
    );
    const result = await service.list({
      userId,
      subjectId: "G",
      limit: 10,
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(
      result.candidates[0]?.stateId,
      dormantAnchor.id,
    );
    assert.equal(
      result.candidates[0]?.threadKey,
      topicThreadKey("Dormant anchor"),
    );

    const rows = await database.db
      .select({
        id: runtimeSubjectStates.id,
        payload: runtimeSubjectStates.payload,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, dormantAnchor.id));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0]?.payload, dormantAnchor.payload);
  },
);
