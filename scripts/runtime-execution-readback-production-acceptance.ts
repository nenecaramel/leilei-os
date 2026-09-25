import "dotenv/config";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationProviderSessionCheckpoints,
  conversations,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/native-live-backend-turn-repository.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/native-live-backend-relay.js";

assert.equal(
  process.env.RUN_PRODUCTION_EXECUTION_READBACK_ACCEPTANCE,
  "1",
  "Set RUN_PRODUCTION_EXECUTION_READBACK_ACCEPTANCE=1 explicitly.",
);

const databaseUrl =
  process.env.ACCEPTANCE_DATABASE_URL
  ?? process.env.DATABASE_URL;
const userId = process.env.MCP_USER_ID;
assert.ok(
  databaseUrl,
  "DATABASE_URL is required. Run through Railway production variables.",
);
assert.ok(
  userId,
  "MCP_USER_ID is required. Run through Railway production variables.",
);

const database = createDatabase(databaseUrl);
const conversationRepository =
  new DrizzleNativeLiveConversationRepository(database.db);
const conversationService =
  new NativeLiveConversationService(conversationRepository);
const turnPort =
  new DrizzleNativeLiveBackendTurnPort(database.db);
const coordinator =
  new NativeLiveBackendTurnCoordinator(turnPort);
const relay =
  new NativeLiveBackendRelayService(
    new DrizzleNativeLiveBackendRelayRepository(database.db),
    coordinator,
  );

const runId = crypto.randomUUID();
const requestId = crypto.randomUUID();
const execution = {
  model: "claude-sonnet-5" as const,
  thinking: "adaptive" as const,
  effort: "low" as const,
};

let conversationId: string | null = null;
let prepareId: string | null = null;
let terminalObserved = false;

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupConversation() {
  if (!conversationId) return;
  await database.db
    .delete(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
}

try {
  const conversation = await conversationService.createConversation({
    userId,
    title: `execution-readback-acceptance:${runId}`,
  });
  conversationId = conversation.id;

  const prepared = await coordinator.prepare(userId, {
    dispatch_target: "claude_code",
    request_id: requestId,
    operation: "send",
    conversation_id: conversation.id,
    expected_head_message_id: null,
    text:
      "Production execution metadata acceptance. Reply only EXECUTION_READBACK_OK.",
    execution,
  });

  assert.equal(prepared.ok, true, "Execution acceptance prepare failed.");
  if (!prepared.ok) throw new Error(prepared.code);
  prepareId = prepared.command.prepare_id;
  assert.deepEqual(prepared.command.execution_selection, execution);

  await relay.enqueuePreparation({
    userId,
    prepareId,
  });

  process.stdout.write(
    JSON.stringify({
      phase: "queued",
      runId,
      conversationId,
      prepareId,
      execution,
      waitingFor: "Mac daemon Agent SDK execution",
    }) + "\n",
  );

  const deadline = Date.now() + 180_000;
  let turn = null;

  while (Date.now() < deadline) {
    turn = await turnPort.readTurn({
      userId,
      prepareId,
    });
    assert.ok(turn, "Prepared turn disappeared.");

    if (
      turn.canonicalStatus === "finalized_success"
      && turn.dispatchStatus === "completed"
    ) {
      terminalObserved = true;
      break;
    }

    if (turn.canonicalStatus === "finalized_failure") {
      terminalObserved = true;
      throw new Error(
        `Runtime finalized failure: ${turn.failureCode ?? "UNKNOWN"}`,
      );
    }

    if (turn.dispatchStatus === "rejected") {
      terminalObserved = true;
      throw new Error(
        `Relay rejected execution: ${turn.failureCode ?? "UNKNOWN"}`,
      );
    }

    await sleep(1_000);
  }

  assert.ok(
    terminalObserved && turn,
    "Execution readback turn did not reach completed terminal state within 180 seconds.",
  );
  assert.equal(turn.canonicalStatus, "finalized_success");
  assert.equal(turn.dispatchStatus, "completed");
  assert.deepEqual(turn.executionSelection, execution);
  assert.ok(turn.assistantMessage);

  const executionMetadata = turn.runtimeMetadata?.execution;
  assert.ok(
    executionMetadata,
    "Finalized turn did not persist execution metadata.",
  );
  assert.equal(
    executionMetadata.readback_error,
    null,
    "Agent SDK execution readback reported unavailable.",
  );
  assert.deepEqual(
    executionMetadata.readback.requested,
    execution,
    "Requested execution selection did not round-trip.",
  );
  assert.equal(
    executionMetadata.readback.applied.model,
    execution.model,
    "Applied model differs from requested model.",
  );
  assert.equal(
    executionMetadata.readback.applied.effort,
    execution.effort,
    "Applied effort differs from requested effort.",
  );
  const capability = executionMetadata.readback.capability;
  if (capability) {
    assert.equal(
      capability.value,
      execution.model,
      "Capability entry does not match the selected model.",
    );
    assert.equal(
      capability.supports_effort,
      true,
      "Capability entry says selected model does not support effort.",
    );
    assert.ok(
      capability.supported_effort_levels.includes(
        execution.effort,
      ),
      "Capability entry does not include the applied effort.",
    );
  }

  const [checkpoint] = await database.db
    .select({
      providerSessionId:
        conversationProviderSessionCheckpoints.providerSessionId,
      runtimeMetadata:
        conversationProviderSessionCheckpoints.runtimeMetadata,
    })
    .from(conversationProviderSessionCheckpoints)
    .where(
      and(
        eq(
          conversationProviderSessionCheckpoints.userId,
          userId,
        ),
        eq(
          conversationProviderSessionCheckpoints.conversationId,
          conversationId,
        ),
        eq(
          conversationProviderSessionCheckpoints.canonicalMessageId,
          turn.assistantMessage.id,
        ),
      ),
    )
    .limit(1);

  assert.ok(checkpoint, "Provider checkpoint was not persisted.");
  assert.ok(checkpoint.providerSessionId.trim());
  assert.deepEqual(
    checkpoint.runtimeMetadata,
    turn.runtimeMetadata,
    "Checkpoint runtime metadata differs from authoritative turn readback.",
  );

  const canonical = await conversationService.getConversation({
    userId,
    conversationId,
  });
  assert.ok(canonical);
  assert.equal(
    canonical.currentHeadMessageId,
    turn.assistantMessage.id,
    "Canonical conversation head did not advance to assistant message.",
  );

  process.stdout.write(
    JSON.stringify({
      phase: "accepted",
      runId,
      conversationId,
      prepareId,
      canonicalStatus: turn.canonicalStatus,
      dispatchStatus: turn.dispatchStatus,
      requested: executionMetadata.readback.requested,
      applied: executionMetadata.readback.applied,
      capability:
        capability
          ? {
              value: capability.value,
              supportsEffort: capability.supports_effort,
              supportedEffortLevels:
                capability.supported_effort_levels,
            }
          : null,
      capabilityObserved: capability !== null,
      checkpointRuntimeMetadataMatches: true,
      canonicalHeadMatchesAssistant: true,
    }) + "\n",
  );

  await cleanupConversation();
  conversationId = null;

  process.stdout.write(
    JSON.stringify({
      phase: "cleaned",
      runId,
      disposableConversationDeleted: true,
    }) + "\n",
  );
} catch (error) {
  let dispatchStatus: string | null = null;
  if (prepareId) {
    try {
      const current = await turnPort.readTurn({
        userId,
        prepareId,
      });
      dispatchStatus = current?.dispatchStatus ?? null;
      if (
        current
        && (
          current.dispatchStatus === "completed"
          || current.dispatchStatus === "rejected"
        )
      ) {
        terminalObserved = true;
      }
    } catch {
      // Preserve original acceptance failure.
    }
  }

  if (terminalObserved || prepareId === null) {
    await cleanupConversation();
    conversationId = null;
  }

  process.stderr.write(
    JSON.stringify({
      phase: "failed",
      runId,
      prepareId,
      dispatchStatus,
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      cleanup:
        terminalObserved || prepareId === null
          ? "completed"
          : "deferred_to_avoid_racing_active_turn",
    }) + "\n",
  );
  throw error;
} finally {
  await database.close();
}
