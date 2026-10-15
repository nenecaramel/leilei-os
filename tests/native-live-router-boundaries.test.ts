import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createNativeLiveApiRouter, type NativeLiveApiDependencies } from "../src/web-api/native-live-router.js";

const allServices = {
  coordinator: {}, relayService: {}, turnReader: {}, turnWaitService: {},
  currentPathReader: {}, conversationRuntimeMetadataReader: {}, conversationService: {},
  runtimeEventService: {}, runtimeInteractionService: {}, runtimeControlService: {},
  manualCompactService: {}, externalSessionBridgeService: {}, attachmentService: {},
} as unknown as NativeLiveApiDependencies;

function inventory(dependencies: NativeLiveApiDependencies) {
  return createNativeLiveApiRouter(dependencies).stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => [Object.keys(layer.route.methods)[0], layer.route.path]);
}

test("Native Live public route methods and registration order remain stable", () => {
  assert.deepEqual(inventory(allServices), [
  [
    "post",
    "/prepare"
  ],
  [
    "post",
    "/attachments/upload-slots"
  ],
  [
    "post",
    "/attachments/:attachmentId/complete"
  ],
  [
    "post",
    "/attachments/:attachmentId/download-slot"
  ],
  [
    "get",
    "/turns/:prepareId"
  ],
  [
    "get",
    "/conversations/:conversationId/active-turn"
  ],
  [
    "post",
    "/turns/:prepareId/wait"
  ],
  [
    "get",
    "/turns/:prepareId/events"
  ],
  [
    "get",
    "/turns/:prepareId/interactions"
  ],
  [
    "post",
    "/turns/:prepareId/interactions/:interactionId/respond"
  ],
  [
    "get",
    "/turns/:prepareId/controls"
  ],
  [
    "post",
    "/turns/:prepareId/controls"
  ],
  [
    "get",
    "/conversations"
  ],
  [
    "post",
    "/conversations"
  ],
  [
    "patch",
    "/conversations/:conversationId"
  ],
  [
    "post",
    "/conversations/:conversationId/archive"
  ],
  [
    "post",
    "/conversations/:conversationId/restore"
  ],
  [
    "delete",
    "/conversations/:conversationId"
  ],
  [
    "get",
    "/conversations/:conversationId/current-path"
  ],
  [
    "get",
    "/conversations/:conversationId/runtime-metadata"
  ],
  [
    "post",
    "/conversations/:conversationId/compact"
  ],
  [
    "get",
    "/manual-compacts/:requestId"
  ],
  [
    "post",
    "/external-sessions/requests"
  ],
  [
    "get",
    "/external-sessions/requests/:requestId"
  ],
  [
    "post",
    "/conversations/from-claude-session"
  ],
  [
    "get",
    "/conversations/:conversationId/history-snapshot"
  ]
]);
  assert.deepEqual(inventory({coordinator: {}, relayService: {}, turnReader: {}} as unknown as NativeLiveApiDependencies), [
    ["post", "/prepare"], ["get", "/turns/:prepareId"], ["get", "/conversations/:conversationId/active-turn"],
  ]);
});

test("Native Live public handlers have feature boundaries behind the existing facade", () => {
  for (const [file, symbol] of [
    ["conversations", "listNativeLiveConversationsHandler"],
    ["turns", "prepareNativeLiveTurnHandler"],
    ["runtime", "readNativeLiveRuntimeEventsHandler"],
    ["attachments", "createNativeLiveAttachmentUploadSlotHandler"],
    ["external-sessions", "createNativeLiveExternalSessionListHandler"],
    ["compact", "createNativeLiveManualCompactHandler"],
  ]) {
    const path = `src/web-api/native-live/${file}.ts`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    assert.match(fs.readFileSync(path, "utf8"), new RegExp(`export function ${symbol}\\(`));
  }
  const composition = fs.readFileSync("src/web-api/native-live/router.ts", "utf8");
  assert.match(composition, /export function createNativeLiveApiRouter/);
  assert.doesNotMatch(composition, /response\.status|request\.body/);
  assert.doesNotMatch(fs.readFileSync("src/web-api/native-live-router.ts", "utf8"), /return async|response\.status/);
});


test("Native Live internal route methods and registration order remain stable", async () => {
  const {createNativeLiveRelayInternalRouter} = await import("../src/web-api/native-live-relay-internal-router.js");
  const dependencies = {
    relayService: {}, semanticService: {}, backgroundModelService: {}, backgroundModelCoordinator: {},
    runtimeEventService: {}, runtimeInteractionService: {}, runtimeControlService: {},
    companionBackgroundOpportunity: {}, workWaitService: {}, providerSessionCleanupService: {},
    manualCompactService: {}, externalSessionBridgeService: {}, attachmentService: {},
  } as any;
  const router = createNativeLiveRelayInternalRouter(dependencies);
  assert.deepEqual(router.stack.filter((layer: any) => layer.route)
    .map((layer: any) => [Object.keys(layer.route.methods)[0], layer.route.path]), [
  [
    "post",
    "/lease/renew"
  ],
  [
    "post",
    "/work/wait"
  ],
  [
    "post",
    "/semantic/reserve"
  ],
  [
    "post",
    "/semantic/reservations/:reservationId/scores"
  ],
  [
    "post",
    "/semantic/reservations/:reservationId/fallback"
  ],
  [
    "post",
    "/background/opportunity"
  ],
  [
    "post",
    "/background-model/reserve"
  ],
  [
    "post",
    "/background-model/reservations/:reservationId/result"
  ],
  [
    "post",
    "/manual-compact/reserve"
  ],
  [
    "post",
    "/manual-compact/reservations/:reservationId/result"
  ],
  [
    "post",
    "/external-sessions/reserve"
  ],
  [
    "post",
    "/external-sessions/reservations/:reservationId/result"
  ],
  [
    "post",
    "/attachments/upload-slots"
  ],
  [
    "post",
    "/attachments/:attachmentId/complete"
  ],
  [
    "post",
    "/attachments/:attachmentId/download-slot"
  ],
  [
    "post",
    "/provider-session-cleanup/reserve"
  ],
  [
    "post",
    "/provider-session-cleanup/reservations/:reservationId/result"
  ],
  [
    "post",
    "/reserve"
  ],
  [
    "post",
    "/reservations/:reservationId/execution-started"
  ],
  [
    "post",
    "/reservations/:reservationId/events/batch"
  ],
  [
    "post",
    "/reservations/:reservationId/interactions"
  ],
  [
    "post",
    "/reservations/:reservationId/interactions/:interactionId/wait"
  ],
  [
    "post",
    "/reservations/:reservationId/interactions/:interactionId/cancel"
  ],
  [
    "post",
    "/reservations/:reservationId/controls/wait"
  ],
  [
    "post",
    "/reservations/:reservationId/controls/:controlId/complete"
  ],
  [
    "post",
    "/reservations/:reservationId/background-results/prepare"
  ],
  [
    "post",
    "/reservations/:reservationId/background-results/:receiptId/result"
  ],
  [
    "post",
    "/reservations/:reservationId/result"
  ],
  [
    "post",
    "/reservations/:reservationId/delivery-unknown"
  ],
  [
    "post",
    "/reservations/:reservationId/reject"
  ]
]);
  assert.equal(router.stack[0].route, undefined);
});

test("Native Live internal handler validation stays with its feature boundary", () => {
  for (const [file, symbol] of [
    ["execution", "submitResultHandler"], ["runtime-events", "appendRuntimeEventBatchHandler"],
    ["interactions", "createRuntimeInteractionHandler"], ["controls", "waitRuntimeControlHandler"],
    ["background", "reserveBackgroundModelHandler"], ["semantic", "reserveSemanticHandler"],
    ["sessions", "reserveExternalSessionsHandler"], ["attachments", "createInternalAttachmentUploadSlotHandler"],
  ]) {
    const path = `src/web-api/native-live-internal/${file}.ts`;
    assert.ok(fs.existsSync(path), `missing ${path}`);
    assert.match(fs.readFileSync(path, "utf8"), new RegExp(`export function ${symbol}\\(`));
  }
  const composition = fs.readFileSync("src/web-api/native-live-internal/router.ts", "utf8");
  assert.match(composition, /createNativeLiveRelayInternalRouter/);
  assert.match(composition, /response.setHeader\("Cache-Control", "private, no-store"\)/);
  assert.doesNotMatch(composition, /request\.body|response\.status/);
  assert.doesNotMatch(fs.readFileSync("src/web-api/native-live-relay-internal-router.ts", "utf8"), /return async|response\.status/);
});
