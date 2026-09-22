import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  runtimeDriveSatisfactionEvents,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  DrizzleSubjectStateRuntimePort,
} from "../src/domains/runtime/subject-state-runtime-repository.js";
import {
  DrizzleDriveEvolutionRuntimePort,
} from "../src/domains/runtime/drive-evolution-runtime-repository.js";
import {
  DriveEvolutionService,
  readDriveEvolution,
  type DriveEvolutionPolicy,
} from "../src/domains/runtime/drive-evolution.js";
import {
  DriveSatisfactionService,
  DrizzleDriveSatisfactionRuntimePort,
} from "../src/domains/runtime/drive-satisfaction-runtime-repository.js";
import type {
  SubjectStateWrite,
} from "../src/domains/runtime/subject-state-contract.js";

const enabled =
  process.env.RUN_RUNTIME_DRIVE_DATABASE_TEST === "1";

const policy: DriveEvolutionPolicy = {
  basePressure: 0.4,
  reinforcementBoost: 0.2,
  activeThreshold: 0.1,
  minEvolutionIntervalHours: 6,
  maxReinforcementSources: 16,
};

function driveState(input: {
  id: string;
  userId: string;
  text: string;
  sourceId: string;
}): SubjectStateWrite {
  return {
    id: input.id,
    kind: "drive",
    text: input.text,
    payload: null,
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
        sources: [{ kind: "message", id: input.sourceId }],
        causedBy: input.sourceId,
        derivedFrom: [],
      },
      versions: {
        schemaVersion: 1,
        ruleVersion: "drive-test",
        processVersion: "drive-test",
      },
    },
  };
}

test(
  "Drive satisfaction requires canonical evidence, is idempotent, and later reinforcement can reactivate pressure",
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
            .delete(conversations)
            .where(eq(conversations.userId, userId));
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
        email: `runtime-drive-${crypto.randomUUID()}@example.com`,
        displayName: "Runtime Drive",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationsRepo =
      new DrizzleNativeLiveConversationRepository(database.db);
    const conversation = await conversationsRepo.createConversation({
      userId,
      title: "Drive satisfaction",
    });
    const evidenceUser = await conversationsRepo.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
    });
    await conversationsRepo.appendContentBlock({
      userId,
      conversationId: conversation.id,
      messageId: evidenceUser.id,
      ordinal: 0,
      block: {
        kind: "text",
        rawType: "text",
        text: "I actually finished the thing I wanted to do.",
      },
    });
    const assistant = await conversationsRepo.appendAssistantMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: evidenceUser.id,
    });
    const toolResult = await conversationsRepo.appendContentBlock({
      userId,
      conversationId: conversation.id,
      messageId: assistant.id,
      ordinal: 0,
      block: {
        kind: "tool_result",
        rawType: "tool_result",
        text: "completed",
        payload: { ok: true },
      },
    });

    const statePort = new DrizzleSubjectStateRuntimePort(database.db);
    const driveIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    await statePort.append({
      userId,
      subjectId: "G",
      states: [
        driveState({
          id: driveIds[0]!,
          userId,
          text: "I want to keep pushing this runtime forward",
          sourceId: "drive-source-1",
        }),
        driveState({
          id: driveIds[1]!,
          userId,
          text: "  I WANT TO KEEP PUSHING THIS RUNTIME FORWARD  ",
          sourceId: "drive-source-2",
        }),
      ],
    });

    const evolutionPort =
      new DrizzleDriveEvolutionRuntimePort(database.db);
    const evolution = new DriveEvolutionService(
      evolutionPort,
      policy,
    );
    const initialized = await evolution.runOnce({
      userId,
      subjectId: "G",
      now: new Date().toISOString(),
    });
    assert.equal(initialized.active, 1);
    assert.equal(initialized.applied, 2);

    const satisfaction = new DriveSatisfactionService(
      evolutionPort,
      new DrizzleDriveSatisfactionRuntimePort(database.db),
      policy,
    );
    const idempotencyKey =
      "drive-satisfy:test:user-message:0001";
    const satisfyInput = {
      userId,
      subjectId: "G",
      driveStateId: driveIds[0]!,
      amount: 0.55,
      idempotencyKey,
      evidence: {
        kind: "user_message" as const,
        conversationId: conversation.id,
        messageId: evidenceUser.id,
      },
      now: new Date().toISOString(),
    };
    const concurrent = await Promise.all([
      satisfaction.satisfy(satisfyInput),
      satisfaction.satisfy(satisfyInput),
    ]);
    assert.deepEqual(
      concurrent.map((result) => result.outcome).sort(),
      ["applied", "idempotent"],
    );
    const applied = concurrent.find(
      (result) => result.outcome === "applied",
    );
    assert.ok(applied && applied.outcome !== "rejected");
    assert.equal(applied.phase, "satisfied");
    assert.equal(applied.pressure, 0.05);
    assert.equal(applied.satisfactionTotal, 0.55);

    const replay = await satisfaction.satisfy({
      userId,
      subjectId: "G",
      driveStateId: driveIds[0]!,
      amount: 0.55,
      idempotencyKey,
      evidence: {
        kind: "user_message",
        conversationId: conversation.id,
        messageId: evidenceUser.id,
      },
      now: new Date().toISOString(),
    });
    assert.equal(replay.outcome, "idempotent");

    const conflict = await satisfaction.satisfy({
      userId,
      subjectId: "G",
      driveStateId: driveIds[0]!,
      amount: 0.2,
      idempotencyKey,
      evidence: {
        kind: "user_message",
        conversationId: conversation.id,
        messageId: evidenceUser.id,
      },
      now: new Date().toISOString(),
    });
    assert.deepEqual(conflict, {
      outcome: "rejected",
      code: "IDEMPOTENCY_CONFLICT",
    });

    const invalidEvidence = await satisfaction.satisfy({
      userId,
      subjectId: "G",
      driveStateId: driveIds[0]!,
      amount: 0.05,
      idempotencyKey: "drive-satisfy:test:assistant-message:0002",
      evidence: {
        kind: "user_message",
        conversationId: conversation.id,
        messageId: assistant.id,
      },
      now: new Date().toISOString(),
    });
    assert.deepEqual(invalidEvidence, {
      outcome: "rejected",
      code: "EVIDENCE_INVALID",
    });

    const toolApplied = await satisfaction.satisfy({
      userId,
      subjectId: "G",
      driveStateId: driveIds[0]!,
      amount: 0.05,
      idempotencyKey: "drive-satisfy:test:tool-result:0003",
      evidence: {
        kind: "tool_result",
        conversationId: conversation.id,
        messageId: assistant.id,
        blockId: toolResult.id,
      },
      now: new Date().toISOString(),
    });
    assert.equal(toolApplied.outcome, "applied");
    if (toolApplied.outcome === "rejected") {
      throw new Error("expected tool-backed satisfaction");
    }
    assert.equal(toolApplied.pressure, 0);
    assert.equal(toolApplied.phase, "satisfied");
    assert.equal(toolApplied.satisfactionTotal, 0.6);

    const events = await database.db
      .select({
        evidenceKind: runtimeDriveSatisfactionEvents.evidenceKind,
        amount: runtimeDriveSatisfactionEvents.amount,
      })
      .from(runtimeDriveSatisfactionEvents)
      .where(eq(runtimeDriveSatisfactionEvents.userId, userId));
    assert.equal(events.length, 2);
    assert.deepEqual(
      new Set(events.map((event) => event.evidenceKind)),
      new Set(["user_message", "tool_result"]),
    );

    const thirdId =
      "33333333-3333-4333-8333-333333333333";
    await statePort.append({
      userId,
      subjectId: "G",
      states: [
        driveState({
          id: thirdId,
          userId,
          text: "I want to keep pushing this runtime forward",
          sourceId: "drive-source-3",
        }),
      ],
    });
    const reactivated = await evolution.runOnce({
      userId,
      subjectId: "G",
      now: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.equal(reactivated.active, 1);

    const rows = await statePort.list({
      userId,
      subjectId: "G",
      conversationId: conversation.id,
    });
    const anchor = rows.find((state) => state.id === driveIds[0]);
    assert.ok(anchor);
    const drive = readDriveEvolution(anchor.payload);
    assert.ok(drive);
    assert.equal(drive.phase, "active");
    assert.equal(drive.pressure, 0.2);
    assert.equal(drive.satisfactionTotal, 0.6);
    assert.equal(drive.reinforcementCount, 3);
  },
);
