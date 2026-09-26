import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { DrizzleSubjectStateRuntimePort } from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  ThoughtEvolutionService,
  readThoughtEvolution,
} from "../src/domains/runtime/thought-evolution.js";
import {
  DrizzleThoughtEvolutionRuntimePort,
} from "../src/domains/runtime/thought-evolution-runtime-repository.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_THOUGHT_DATABASE_TEST === "1";

test(
  "settled repeated Thoughts persist one Fixation anchor and reinforcement metadata",
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
        email: `runtime-thought-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Thought",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const states: SubjectStateWrite[] = ids.map((id, index) => ({
      id,
      kind: "thought",
      text:
        index === 1
          ? "  I keep wondering how memory changes identity  "
          : index === 2
            ? "I KEEP WONDERING HOW MEMORY CHANGES IDENTITY"
            : "I keep wondering how memory changes identity",
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
          sources: [{ kind: "event", id: `thought-source-${index + 1}` }],
          causedBy: `thought-source-${index + 1}`,
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "thought-test",
          processVersion: "thought-test",
        },
      },
    }));

    const subjectState = new DrizzleSubjectStateRuntimePort(database.db);
    await subjectState.append({
      userId,
      subjectId: "G",
      states,
    });

    const service = new ThoughtEvolutionService(
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

    const result = await service.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(result.fixations, 1);
    assert.equal(result.applied, 3);
    assert.equal(result.conflicts, 0);

    const rows = await subjectState.list({
      userId,
      subjectId: "G",
      conversationId: crypto.randomUUID(),
    });
    const thoughts = rows
      .filter((state) => state.kind === "thought")
      .sort((left, right) => left.id.localeCompare(right.id));
    assert.equal(thoughts.length, 3);

    const anchor = readThoughtEvolution(thoughts[0]?.payload);
    assert.ok(anchor);
    assert.equal(anchor.stage, "fixation");
    assert.equal(anchor.role, "anchor");
    assert.equal(anchor.anchorStateId, ids[0]);
    assert.equal(anchor.reinforcementCount, 3);
    assert.equal(anchor.reinforcementSources.length, 3);

    const reinforcement = readThoughtEvolution(thoughts[2]?.payload);
    assert.ok(reinforcement);
    assert.equal(reinforcement.stage, "fixation");
    assert.equal(reinforcement.role, "reinforcement");
    assert.equal(reinforcement.anchorStateId, ids[0]);

    const second = await service.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 120_000).toISOString(),
    });
    assert.equal(second.applied, 0);
    assert.equal(second.fixations, 1);
  },
);
