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
  DrizzleTopicResurfaceThoughtMaterializationPort,
} from "../src/domains/runtime/topic-resurface-thought-materialization-runtime-repository.js";
import {
  TopicResurfaceThoughtMaterializationService,
  topicResurfaceThoughtStateId,
  type TopicResurfaceThoughtMaterializationConfig,
} from "../src/domains/runtime/topic-resurface-thought-materialization.js";
import {
  ThoughtEvolutionService,
  readThoughtEvolution,
} from "../src/domains/runtime/thought-evolution.js";
import {
  DrizzleThoughtEvolutionRuntimePort,
} from "../src/domains/runtime/thought-evolution-runtime-repository.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";

const config: TopicResurfaceThoughtMaterializationConfig = {
  ruleVersion: "topic-resurface-thought-v1",
  processVersion: "topic-resurface-thought-materialization-v1",
  deliberationPromptContractVersion: "topic-resurface-deliberation-v1",
  retentionPromptContractVersion: "topic-resurface-retention-v1",
  model: {
    provider: "anthropic",
    model: "claude-code-test",
    configVersion: "test",
    promptContractVersion: "topic-resurface-v1",
  },
};

function topicState(input: {
  id: string;
  userId: string;
  text: string;
  phase: "active" | "dormant";
  causedBy: string;
}): SubjectStateWrite {
  const threadKey = topicThreadKey(input.text);
  const dormantAt =
    input.phase === "dormant"
      ? "2026-09-23T00:00:00.000Z"
      : null;

  return {
    id: input.id,
    kind: "topic",
    text: input.text,
    payload: writeTopicEvolution(null, {
      phase: input.phase,
      role: "anchor",
      threadKey,
      anchorStateId: input.id,
      reinforcementCount: 2,
      reinforcementSources: [input.causedBy],
      lastEvolvedAt: "2026-09-23T00:00:00.000Z",
      lastReinforcedAt: "2026-09-20T00:00:00.000Z",
      dormantAt,
    }),
    envelope: {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "claude-code" },
      committer: { kind: "runtime", id: "leileios-runtime" },
      authority: "subject_authorized",
      scope: {
        userId: input.userId,
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "sensitive",
        audience: ["G"],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "message", id: input.causedBy }],
        causedBy: input.causedBy,
        derivedFrom: [],
        decisionId: null,
        processRunId: null,
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "topic-source-test",
        processVersion: "topic-source-test",
        model: null,
      },
    },
  };
}

function thoughtSeedResult(input: {
  topicId: string;
  topicText: string;
  reflection: string;
}) {
  return {
    outcome: "thought_seed_candidate" as const,
    evaluatedAt: "2026-09-23T01:00:00.000Z",
    candidateCount: 1,
    candidate: {
      stateId: input.topicId,
      text: input.topicText,
      threadKey: topicThreadKey(input.topicText),
      reinforcementCount: 2,
      lastReinforcedAt: "2026-09-20T00:00:00.000Z",
      dormantAt: "2026-09-23T00:00:00.000Z",
    },
    text: input.reflection,
  };
}

test(
  "Topic resurface Thought materialization is source-guarded, idempotent and does not create independent reinforcement",
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
          `runtime-topic-resurface-thought-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Topic Resurface Thought",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const topicId = crypto.randomUUID();
    const activeTopicId = crypto.randomUUID();
    const causedBy = "assistant-message-source-1";
    const topicText = "继续想这个边界问题";
    const reflection =
      "我注意到这里真正持续的是边界问题，而不是某个实现细节。";

    const subjectStates = new DrizzleSubjectStateRuntimePort(database.db);
    await subjectStates.append({
      userId,
      subjectId: "G",
      states: [
        topicState({
          id: topicId,
          userId,
          text: topicText,
          phase: "dormant",
          causedBy,
        }),
        topicState({
          id: activeTopicId,
          userId,
          text: "仍然活跃的 Topic",
          phase: "active",
          causedBy: "assistant-message-source-2",
        }),
      ],
    });

    const port =
      new DrizzleTopicResurfaceThoughtMaterializationPort(database.db);
    const first = new TopicResurfaceThoughtMaterializationService(
      {
        async runOnce() {
          return thoughtSeedResult({
            topicId,
            topicText,
            reflection,
          });
        },
      },
      port,
      config,
    );

    const firstResult = await first.runOnce({
      userId,
      subjectId: "G",
      now: "2026-09-23T01:00:00.000Z",
      candidateLimit: 5,
    });
    const derivedThoughtId = topicResurfaceThoughtStateId(topicId);
    assert.deepEqual(firstResult, {
      outcome: "materialized",
      stateId: derivedThoughtId,
    });

    const afterFirst = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    const derived = afterFirst.find(
      (state) => state.id === derivedThoughtId,
    );
    assert.ok(derived);
    assert.equal(derived.kind, "thought");
    assert.equal(derived.text, reflection);
    assert.equal(derived.envelope.authority, "derived");
    assert.equal(
      derived.envelope.status.presentationStatus,
      "not_presented",
    );
    assert.equal(
      derived.envelope.scope.applicability,
      "global",
    );
    assert.equal(
      derived.envelope.scope.sensitivity,
      "sensitive",
    );
    assert.deepEqual(
      derived.envelope.provenance.sources,
      [{ kind: "persistent_state", id: topicId }],
    );
    assert.equal(
      derived.envelope.provenance.causedBy,
      causedBy,
    );
    assert.deepEqual(
      derived.envelope.provenance.derivedFrom,
      [topicId],
    );
    assert.deepEqual(
      derived.envelope.versions.model,
      config.model,
    );

    const secondReflection =
      "同一个 Topic 后续又产生了一段不同 reflection。";
    const second = new TopicResurfaceThoughtMaterializationService(
      {
        async runOnce() {
          return thoughtSeedResult({
            topicId,
            topicText,
            reflection: secondReflection,
          });
        },
      },
      port,
      config,
    );
    assert.deepEqual(
      await second.runOnce({
        userId,
        subjectId: "G",
        now: "2026-09-23T02:00:00.000Z",
        candidateLimit: 5,
      }),
      {
        outcome: "already_materialized",
        stateId: derivedThoughtId,
      },
    );

    const afterSecond = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    const stillOriginal = afterSecond.find(
      (state) => state.id === derivedThoughtId,
    );
    assert.equal(stillOriginal?.text, reflection);

    const staleActive = new TopicResurfaceThoughtMaterializationService(
      {
        async runOnce() {
          return thoughtSeedResult({
            topicId: activeTopicId,
            topicText: "仍然活跃的 Topic",
            reflection: "不应落库",
          });
        },
      },
      port,
      config,
    );
    assert.deepEqual(
      await staleActive.runOnce({
        userId,
        subjectId: "G",
        now: "2026-09-23T03:00:00.000Z",
        candidateLimit: 5,
      }),
      { outcome: "source_ineligible" },
    );
    const afterStale = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    assert.equal(
      afterStale.some(
        (state) =>
          state.id === topicResurfaceThoughtStateId(activeTopicId),
      ),
      false,
    );

    const manualThoughtId = crypto.randomUUID();
    await subjectStates.append({
      userId,
      subjectId: "G",
      states: [{
        id: manualThoughtId,
        kind: "thought",
        text: reflection,
        payload: null,
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "model", id: "claude-code" },
          committer: { kind: "runtime", id: "leileios-runtime" },
          authority: "subject_authorized",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "sensitive",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [{ kind: "message", id: causedBy }],
            causedBy,
            derivedFrom: [],
            decisionId: null,
            processRunId: null,
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "manual-thought-test",
            processVersion: "manual-thought-test",
            model: null,
          },
        },
      }],
    });

    const evolution = new ThoughtEvolutionService(
      new DrizzleThoughtEvolutionRuntimePort(database.db),
      {
        flitHalfLifeHours: 168,
        baseStrength: 0.35,
        reinforcementBoost: 0.25,
        fixationThreshold: 0.75,
        minEvolutionIntervalHours: 6,
        maxReinforcementSources: 16,
      },
    );
    await evolution.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 60_000).toISOString(),
    });

    const evolved = await subjectStates.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    const derivedAfterEvolution = evolved.find(
      (state) => state.id === derivedThoughtId,
    );
    const manualAfterEvolution = evolved.find(
      (state) => state.id === manualThoughtId,
    );
    assert.ok(derivedAfterEvolution);
    assert.ok(manualAfterEvolution);
    assert.equal(
      readThoughtEvolution(
        derivedAfterEvolution.payload,
      )?.reinforcementCount,
      1,
    );
    assert.equal(
      readThoughtEvolution(
        manualAfterEvolution.payload,
      )?.reinforcementCount,
      1,
    );
  },
);
