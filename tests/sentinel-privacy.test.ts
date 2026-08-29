import assert from "node:assert/strict";
import test from "node:test";
import { BridgeService } from "../src/domains/bridge/bridge-service.js";
import type { BridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import { createSafeLogger } from "../src/observability/logger.js";
import { createBridgeObserver } from "../src/observability/runtime-observers.js";

const PRIVATE_FIXTURES = {
  policy: "POLICY_PROMPT_PRIVATE_SENTINEL",
  capsule: "CONTEXT_CAPSULE_PRIVATE_SENTINEL",
  modelContext: "HIDDEN_MODEL_CONTEXT_PRIVATE_SENTINEL",
  authorization: "Bearer AUTH_TOKEN_PRIVATE_SENTINEL",
  databaseUrl: "postgresql://private:credential@private.invalid/private",
  databaseDetail: "RAW_DATABASE_DETAIL_PRIVATE_SENTINEL",
  assistantBody: "ASSISTANT_RESPONSE_BODY_PRIVATE_SENTINEL",
} as const;

test("Sentinel and Bridge observability excludes every private runtime payload", async () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    now: () => new Date("2026-08-30T00:00:00.000Z"),
    sink: (_level, line) => lines.push(line),
  });
  const observe = createBridgeObserver(logger);
  const createdAt = new Date("2026-08-30T00:00:00.000Z");
  const repository = {
    createEvent: async (_userId: string, input: Record<string, unknown>) => ({
      outcome: "created",
      event: {
        ...input,
        id: input.id,
        userId: "owner-private-sentinel",
        status: "pending",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        dispatchStartedAt: null,
        hostSentAt: null,
        deliveryUnknownAt: null,
        cancelledAt: null,
        processingState: "unclaimed",
        modelClaimedAt: null,
        modelCompletedAt: null,
        deliveryReconciledAt: null,
        retryCount: 0,
        lastErrorCode: null,
      },
    }),
  } as unknown as BridgeEventRepository;
  const service = new BridgeService(repository, {
    createId: () => "11111111-1111-4111-8111-111111111111",
    now: () => createdAt,
    observe,
  });

  await service.createPwaEvent(
    "owner-private-sentinel",
    PRIVATE_FIXTURES.assistantBody,
    "privacy-bridge-event-0001",
  );
  observe({
    name: "bridge_event_processing_conflict",
    eventId: "11111111-1111-4111-8111-111111111111",
    operation: "claim",
    outcome: "conflict",
    policyPrompt: PRIVATE_FIXTURES.policy,
    contextCapsule: PRIVATE_FIXTURES.capsule,
    modelContext: PRIVATE_FIXTURES.modelContext,
    Authorization: PRIVATE_FIXTURES.authorization,
    databaseUrl: PRIVATE_FIXTURES.databaseUrl,
    error: PRIVATE_FIXTURES.databaseDetail,
    assistantResponse: PRIVATE_FIXTURES.assistantBody,
  } as never);

  const serialized = lines.join("\n");
  assert.ok(lines.length >= 2);
  assert.match(serialized, /bridge_event_created/);
  assert.match(serialized, /bridge_event_processing_conflict/);
  for (const [name, privateValue] of Object.entries(PRIVATE_FIXTURES)) {
    assert.equal(serialized.includes(privateValue), false, `${name} leaked into safe logs`);
  }
  assert.doesNotMatch(
    serialized,
    /policyPrompt|contextCapsule|modelContext|Authorization|DATABASE_URL|databaseUrl|assistantResponse|stack|detail/i,
  );
});

test("safe failure logging retains only bounded fingerprints", () => {
  const lines: string[] = [];
  const logger = createSafeLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });

  logger.error("sentinel_runtime_failed", {
    name: "PostgresError",
    code: "XX000",
    policyPrompt: PRIVATE_FIXTURES.policy,
    contextCapsule: PRIVATE_FIXTURES.capsule,
    Authorization: PRIVATE_FIXTURES.authorization,
    DATABASE_URL: PRIVATE_FIXTURES.databaseUrl,
    detail: PRIVATE_FIXTURES.databaseDetail,
    assistantResponse: PRIVATE_FIXTURES.assistantBody,
  } as never);

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.event, "sentinel_runtime_failed");
  assert.equal(parsed.name, "PostgresError");
  assert.equal(parsed.code, "XX000");
  for (const privateValue of Object.values(PRIVATE_FIXTURES)) {
    assert.equal(lines[0]!.includes(privateValue), false);
  }
});
