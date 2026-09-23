import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  createTopicResurfaceBackgroundPipeline,
} from "../src/domains/runtime/topic-resurface-background-pipeline.js";
import {
  TopicResurfaceBackgroundTrigger,
  type TopicResurfaceBackgroundObserverEvent,
} from "../src/domains/runtime/topic-resurface-background-trigger.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  topicResurfaceThoughtStateId,
} from "../src/domains/runtime/topic-resurface-thought-materialization.js";
import {
  topicThreadKey,
  writeTopicEvolution,
} from "../src/domains/runtime/topic-evolution.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";

function dormantTopic(input: {
  id: string;
  userId: string;
  text: string;
  causedBy: string;
}): SubjectStateWrite {
  const threadKey = topicThreadKey(input.text);
  return {
    id: input.id,
    kind: "topic",
    text: input.text,
    payload: writeTopicEvolution(null, {
      phase: "dormant",
      role: "anchor",
      threadKey,
      anchorStateId: input.id,
      reinforcementCount: 1,
      reinforcementSources: [input.causedBy],
      lastEvolvedAt: "2026-09-23T00:00:00.000Z",
      lastReinforcedAt: "2026-09-20T00:00:00.000Z",
      dormantAt: "2026-09-23T00:00:00.000Z",
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
        sensitivity: "normal",
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
        ruleVersion: "background-pipeline-test",
        processVersion: "background-pipeline-test",
        model: null,
      },
    },
  };
}

test(
  "Topic resurface background pipeline runs end-to-end as an internal background task",
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
          `runtime-topic-resurface-background-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Topic Resurface Background",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const topicId = crypto.randomUUID();
    const causedBy = "assistant-message-background-source";
    const topicText = "继续想 Topic resurface 的边界";
    await new DrizzleSubjectStateRuntimePort(database.db).append({
      userId,
      subjectId: "G",
      states: [dormantTopic({
        id: topicId,
        userId,
        text: topicText,
        causedBy,
      })],
    });

    const outputs = [
      JSON.stringify({
        decision: "consider",
        state_id: topicId,
      }),
      JSON.stringify({
        decision: "reflect",
        reflection:
          "这个 Topic 反复留下来的核心是内部思考与外部主动行为必须分层。",
      }),
      JSON.stringify({
        decision: "retain_as_thought_seed",
      }),
    ];
    const prompts: string[] = [];
    const runtime = {
      async sendNew(prompt: string) {
        prompts.push(prompt);
        const finalText = outputs.shift();
        assert.ok(finalText, "unexpected extra Claude call");
        return {
          providerSessionId: `background-pipeline-${prompts.length}`,
          normalizedEvents: [{
            type: "result" as const,
            payload: {
              status: "success",
              final_text: finalText,
            },
          }],
        };
      },
    };

    const pipeline = createTopicResurfaceBackgroundPipeline({
      db: database.db,
      runtime,
      config: {
        ruleVersion: "topic-resurface-thought-v1",
        processVersion: "topic-resurface-thought-materialization-v1",
        deliberationPromptContractVersion:
          "topic-resurface-deliberation-v1",
        retentionPromptContractVersion:
          "topic-resurface-retention-v1",
        model: {
          provider: "claude_code",
          model: "subscription-test",
          configVersion: "test",
          promptContractVersion: "topic-resurface-v1",
        },
      },
    });

    const observed: TopicResurfaceBackgroundObserverEvent[] = [];
    const trigger = new TopicResurfaceBackgroundTrigger(
      pipeline,
      5,
      () => "2026-09-23T02:20:00.000Z",
      (event) => observed.push(event),
    );

    trigger.schedule({ userId, subjectId: "G" });
    await trigger.drain();

    const thoughtId = topicResurfaceThoughtStateId(
      topicId,
      causedBy,
    );
    assert.deepEqual(observed, [{
      name: "topic_resurface_background_run",
      userId,
      subjectId: "G",
      result: {
        outcome: "materialized",
        stateId: thoughtId,
      },
    }]);
    assert.equal(prompts.length, 3);
    assert.equal(outputs.length, 0);

    const states = await new DrizzleSubjectStateRuntimePort(
      database.db,
    ).list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    const thought = states.find((state) => state.id === thoughtId);
    assert.ok(thought);
    assert.equal(thought.kind, "thought");
    assert.equal(thought.envelope.authority, "derived");
    assert.equal(
      thought.envelope.status.presentationStatus,
      "not_presented",
    );

    assert.equal(
      states.filter((state) => state.kind === "thought").length,
      1,
    );
  },
);
