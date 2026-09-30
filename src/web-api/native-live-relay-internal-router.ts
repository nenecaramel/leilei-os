import { Router, type RequestHandler, type Response } from "express";
import {
  NativeLiveBackendRelayError,
  type NativeLiveBackendRelayService,
} from "../domains/bridge/native-live-backend-relay.js";
import type {
  NativeLiveDaemonRejectCode,
} from "../domains/bridge/native-live-mac-daemon-loop.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../domains/bridge/native-live-runtime-protocol.js";
import {
  NativeLiveSemanticHandshakeError,
  type NativeLiveSemanticFallbackCode,
  type NativeLiveSemanticHandshakeService,
} from "../domains/bridge/native-live-semantic-handshake.js";
import {
  NativeLiveBackgroundModelQueueError,
  type NativeLiveBackgroundModelQueueService,
} from "../domains/bridge/native-live-background-model-queue.js";
import {
  parseNativeLiveBackgroundModelExecutionResult,
  type NativeLiveBackgroundModelExecutionResult,
} from "../domains/bridge/native-live-background-model-protocol.js";
import type {
  NativeLiveBackgroundWorkflowCoordinator,
} from "../domains/bridge/native-live-background-workflow-coordinator.js";
import type {
  TopicResurfaceCrossDeviceOpportunity,
} from "../domains/runtime/topic-resurface-cross-device-opportunity.js";
import {
  NativeLiveRuntimeEventError,
  type NativeLiveRuntimeEventService,
} from "../domains/bridge/native-live-runtime-event-stream.js";
import type {
  NativeLiveNormalizedEvent,
} from "../domains/conversation/native-live-conversation-orchestrator.js";
import {
  NativeLiveRuntimeInteractionError,
  type NativeLiveRuntimeInteractionService,
} from "../domains/bridge/native-live-runtime-interaction.js";
import {
  NativeLiveRuntimeControlError,
  type NativeLiveRuntimeControlService,
} from "../domains/bridge/native-live-runtime-control.js";
import type {
  CompanionBackgroundOpportunityService,
} from "../domains/runtime/companion-background-opportunity.js";
import type {
  NativeLiveWorkWaitService,
} from "../domains/bridge/native-live-work-wake.js";
import {
  NativeLiveProviderSessionCleanupError,
  type NativeLiveProviderSessionCleanupService,
} from "../domains/bridge/native-live-provider-session-cleanup.js";
import {
  NativeLiveManualCompactError,
  type NativeLiveManualCompactService,
} from "../domains/bridge/native-live-manual-compact.js";
import {
  NativeLiveExternalSessionBridgeError,
  type NativeLiveExternalSessionBridgeService,
} from "../domains/bridge/native-live-external-session-bridge.js";
import {
  MindSemanticGroupingRepositoryError,
  type DrizzleMindSemanticGroupingRepository,
} from "../domains/runtime/mind-semantic-grouping-runtime-repository.js";
import {
  NativeLiveAttachmentError,
  type NativeLiveAttachmentService,
} from "../domains/bridge/native-live-attachment-service.js";

export type NativeLiveRelayInternalDependencies = {
  relayService: Pick<
    NativeLiveBackendRelayService,
    | "renewLease"
    | "reserveNext"
    | "markExecutionStarted"
    | "submitResult"
    | "markResultDeliveryUnknown"
    | "rejectReservation"
  >;
  semanticService?: Pick<
    NativeLiveSemanticHandshakeService,
    "reserveNext" | "submitScores" | "submitFallback"
  >;
  mindSemanticGrouping?: Pick<
    DrizzleMindSemanticGroupingRepository,
    "reserveNext" | "acceptScores" | "acceptFallback"
  >;
  backgroundModelService?: Pick<
    NativeLiveBackgroundModelQueueService,
    "reserveNext" | "submitResult"
  >;
  backgroundModelCoordinator?: Pick<
    NativeLiveBackgroundWorkflowCoordinator,
    "advanceNextForUser"
  >;
  backgroundModelOpportunity?: Pick<
    TopicResurfaceCrossDeviceOpportunity,
    "offer"
  >;
  runtimeEventService?: Pick<
    NativeLiveRuntimeEventService,
    "appendBatch"
  >;
  runtimeInteractionService?: Pick<
    NativeLiveRuntimeInteractionService,
    "create" | "waitForListener" | "cancelForListener"
  >;
  runtimeControlService?: Pick<
    NativeLiveRuntimeControlService,
    "waitNextForListener" | "completeForListener"
  >;
  companionBackgroundOpportunity?: Pick<
    CompanionBackgroundOpportunityService,
    "offer"
  >;
  observeCompanionBackgroundOpportunity?: (event: {
    outcome: "offered" | "failed";
    reason: "startup" | "dirty" | "due";
    maintenanceKindCount: number;
    effectDeliveryScheduled: boolean;
    proactivityScheduled: boolean;
    topicResurfaceOffered: boolean;
    failureCount: number;
  }) => void;
  workWaitService?: Pick<NativeLiveWorkWaitService, "wait">;
  providerSessionCleanupService?: Pick<
    NativeLiveProviderSessionCleanupService,
    "reserveNext" | "complete"
  >;
  manualCompactService?: Pick<
    NativeLiveManualCompactService,
    "reserveNext" | "complete"
  >;
  externalSessionBridgeService?: Pick<
    NativeLiveExternalSessionBridgeService,
    "reserveNext" | "complete"
  >;
  attachmentService?: Pick<
    NativeLiveAttachmentService,
    "createUploadSlot" | "completeUpload" | "createDownloadSlot"
  >;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createNativeLiveRelayInternalRouter(
  dependencies: NativeLiveRelayInternalDependencies,
): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
  router.post("/lease/renew", renewLeaseHandler(dependencies));
  if (dependencies.workWaitService) {
    router.post("/work/wait", waitForWorkHandler(dependencies));
  }
  if (dependencies.semanticService) {
    router.post(
      "/semantic/reserve",
      reserveSemanticHandler(dependencies),
    );
    router.post(
      "/semantic/reservations/:reservationId/scores",
      submitSemanticScoresHandler(dependencies),
    );
    router.post(
      "/semantic/reservations/:reservationId/fallback",
      submitSemanticFallbackHandler(dependencies),
    );
  }
  if (dependencies.mindSemanticGrouping) {
    router.post(
      "/mind-semantic-grouping/reserve",
      reserveMindSemanticGroupingHandler(dependencies),
    );
    router.post(
      "/mind-semantic-grouping/reservations/:reservationId/scores",
      submitMindSemanticGroupingScoresHandler(dependencies),
    );
    router.post(
      "/mind-semantic-grouping/reservations/:reservationId/fallback",
      submitMindSemanticGroupingFallbackHandler(dependencies),
    );
  }
  if (dependencies.companionBackgroundOpportunity) {
    router.post(
      "/background/opportunity",
      companionBackgroundOpportunityHandler(dependencies),
    );
  }
  if (dependencies.backgroundModelService) {
    router.post(
      "/background-model/reserve",
      reserveBackgroundModelHandler(dependencies),
    );
    router.post(
      "/background-model/reservations/:reservationId/result",
      submitBackgroundModelResultHandler(dependencies),
    );
    router.post(
      "/background-model/topic-resurface/opportunity",
      topicResurfaceOpportunityHandler(dependencies),
    );
  }
  if (dependencies.manualCompactService) {
    router.post(
      "/manual-compact/reserve",
      reserveManualCompactHandler(dependencies),
    );
    router.post(
      "/manual-compact/reservations/:reservationId/result",
      submitManualCompactResultHandler(dependencies),
    );
  }
  if (dependencies.externalSessionBridgeService) {
    router.post(
      "/external-sessions/reserve",
      reserveExternalSessionsHandler(dependencies),
    );
    router.post(
      "/external-sessions/reservations/:reservationId/result",
      submitExternalSessionsResultHandler(dependencies),
    );
  }
  if (dependencies.attachmentService) {
    router.post(
      "/attachments/upload-slots",
      createInternalAttachmentUploadSlotHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/complete",
      completeInternalAttachmentUploadHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/download-slot",
      createInternalAttachmentDownloadSlotHandler(dependencies),
    );
  }
  if (dependencies.providerSessionCleanupService) {
    router.post(
      "/provider-session-cleanup/reserve",
      reserveProviderSessionCleanupHandler(dependencies),
    );
    router.post(
      "/provider-session-cleanup/reservations/:reservationId/result",
      submitProviderSessionCleanupResultHandler(dependencies),
    );
  }
  router.post("/reserve", reserveNextHandler(dependencies));
  router.post(
    "/reservations/:reservationId/execution-started",
    executionStartedHandler(dependencies),
  );
  if (dependencies.runtimeEventService) {
    router.post(
      "/reservations/:reservationId/events/batch",
      appendRuntimeEventBatchHandler(dependencies),
    );
  }
  if (dependencies.runtimeInteractionService) {
    router.post(
      "/reservations/:reservationId/interactions",
      createRuntimeInteractionHandler(dependencies),
    );
    router.post(
      "/reservations/:reservationId/interactions/:interactionId/wait",
      waitRuntimeInteractionHandler(dependencies),
    );
    router.post(
      "/reservations/:reservationId/interactions/:interactionId/cancel",
      cancelRuntimeInteractionHandler(dependencies),
    );
  }
  if (dependencies.runtimeControlService) {
    router.post(
      "/reservations/:reservationId/controls/wait",
      waitRuntimeControlHandler(dependencies),
    );
    router.post(
      "/reservations/:reservationId/controls/:controlId/complete",
      completeRuntimeControlHandler(dependencies),
    );
  }
  router.post(
    "/reservations/:reservationId/result",
    submitResultHandler(dependencies),
  );
  router.post(
    "/reservations/:reservationId/delivery-unknown",
    deliveryUnknownHandler(dependencies),
  );
  router.post(
    "/reservations/:reservationId/reject",
    rejectReservationHandler(dependencies),
  );
  return router;
}

function renewLeaseHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const state = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      response.json({ success: true, data: { state } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function createInternalAttachmentUploadSlotHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const body = parseInternalAttachmentUploadBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.attachmentService.createUploadSlot({
          userId,
          filename: body.filename,
          mimeType: body.mime_type,
          sizeBytes: body.size_bytes,
          sha256: body.sha256,
          kind: body.kind,
        });
      response.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

function completeInternalAttachmentUploadHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const attachmentId =
      typeof request.params.attachmentId === "string"
        ? request.params.attachmentId
        : "";
    if (!UUID_PATTERN.test(attachmentId)) {
      sendInvalid(response);
      return;
    }
    try {
      const attachment =
        await dependencies.attachmentService.completeUpload({
          userId,
          attachmentId,
        });
      response.json({
        success: true,
        data: { attachment },
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

function createInternalAttachmentDownloadSlotHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId =
      requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.attachmentService) return;
    const attachmentId =
      typeof request.params.attachmentId === "string"
        ? request.params.attachmentId
        : "";
    if (!UUID_PATTERN.test(attachmentId)) {
      sendInvalid(response);
      return;
    }
    try {
      const result =
        await dependencies.attachmentService.createDownloadSlot({
          userId,
          attachmentId,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendInternalAttachmentError(response, error);
    }
  };
}

function waitForWorkHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.workWaitService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const lease = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") {
        response.json({
          success: true,
          data: { outcome: "busy" },
        });
        return;
      }

      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.once("close", onClose);
      try {
        const result = await dependencies.workWaitService.wait({
          userId,
          timeoutMs: 45_000,
          signal: controller.signal,
        });
        if (!response.writableEnded && !controller.signal.aborted) {
          response.json({
            success: true,
            data: result,
          });
        }
      } finally {
        response.off("close", onClose);
      }
    } catch (error) {
      if (response.writableEnded) return;
      if (error instanceof NativeLiveBackendRelayError) {
        sendRelayError(response, error);
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_WORK_WAIT_UNAVAILABLE",
          message: "Native live work wait is temporarily unavailable.",
        },
      });
    }
  };
}

function reserveSemanticHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation = await dependencies.semanticService.reserveNext({
        userId,
        listenerInstanceId: body.listener_instance_id,
      });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

function submitSemanticScoresHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticScoresBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.semanticService.submitScores({
        userId,
        listenerInstanceId: body.listener_instance_id,
        prepareId: reservationId,
        scores: body.scores,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

function submitSemanticFallbackHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.semanticService) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticFallbackBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.semanticService.submitFallback({
        userId,
        listenerInstanceId: body.listener_instance_id,
        prepareId: reservationId,
        code: body.code,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendSemanticError(response, error);
    }
  };
}

function reserveMindSemanticGroupingHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.mindSemanticGrouping) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation =
        await dependencies.mindSemanticGrouping.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({ success: true, data: reservation });
    } catch (error) {
      sendMindSemanticGroupingError(response, error);
    }
  };
}

function submitMindSemanticGroupingScoresHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.mindSemanticGrouping) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticScoresBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.mindSemanticGrouping.acceptScores({
        userId,
        listenerInstanceId: body.listener_instance_id,
        requestId: reservationId,
        scores: body.scores,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendMindSemanticGroupingError(response, error);
    }
  };
}

function submitMindSemanticGroupingFallbackHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.mindSemanticGrouping) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseSemanticFallbackBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.mindSemanticGrouping.acceptFallback({
        userId,
        listenerInstanceId: body.listener_instance_id,
        requestId: reservationId,
        code: body.code,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendMindSemanticGroupingError(response, error);
    }
  };
}

function companionBackgroundOpportunityHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.companionBackgroundOpportunity) return;
    const body = parseCompanionBackgroundOpportunityBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const result =
        await dependencies.companionBackgroundOpportunity.offer({
          userId,
          reason: body.reason,
        });
      bestEffortObserveCompanionBackgroundOpportunity(
        dependencies,
        {
          outcome: "offered",
          reason: body.reason,
          maintenanceKindCount: result.maintenanceKinds.length,
          effectDeliveryScheduled: result.effectDeliveryScheduled,
          proactivityScheduled: result.proactivityScheduled,
          topicResurfaceOffered: result.topicResurfaceOffered,
          failureCount: result.failures.length,
        },
      );
      response.json({
        success: true,
        data: result,
      });
    } catch {
      bestEffortObserveCompanionBackgroundOpportunity(
        dependencies,
        {
          outcome: "failed",
          reason: body.reason,
          maintenanceKindCount: 0,
          effectDeliveryScheduled: false,
          proactivityScheduled: false,
          topicResurfaceOffered: false,
          failureCount: 1,
        },
      );
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_COMPANION_BACKGROUND_UNAVAILABLE",
          message:
            "Companion background opportunity is temporarily unavailable.",
        },
      });
    }
  };
}

function bestEffortObserveCompanionBackgroundOpportunity(
  dependencies: NativeLiveRelayInternalDependencies,
  event: Parameters<
    NonNullable<
      NativeLiveRelayInternalDependencies[
        "observeCompanionBackgroundOpportunity"
      ]
    >
  >[0],
): void {
  try {
    dependencies.observeCompanionBackgroundOpportunity?.(event);
  } catch {
    // Acceptance observability must never affect runtime behavior.
  }
}

function topicResurfaceOpportunityHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    if (!dependencies.backgroundModelOpportunity) {
      response.json({
        success: true,
        data: { outcome: "disabled" },
      });
      return;
    }

    try {
      const result =
        await dependencies.backgroundModelOpportunity.offer({
          userId,
        });
      response.json({
        success: true,
        data: result,
      });
    } catch {
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_TOPIC_RESURFACE_OPPORTUNITY_UNAVAILABLE",
          message:
            "Topic resurface background opportunity is temporarily unavailable.",
        },
      });
    }
  };
}

function reserveBackgroundModelHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      await bestEffortAdvanceBackgroundWorkflow(
        dependencies,
        userId,
      );
      const reservation =
        await dependencies.backgroundModelService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendBackgroundModelError(response, error);
    }
  };
}

function submitBackgroundModelResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.backgroundModelService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseBackgroundModelResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.backgroundModelService.submitResult({
        userId,
        listenerInstanceId: body.listener_instance_id,
        taskId: reservationId,
        result: body.result,
      });
      await bestEffortAdvanceBackgroundWorkflow(
        dependencies,
        userId,
      );
      response.json({
        success: true,
        data: { accepted: true },
      });
    } catch (error) {
      sendBackgroundModelError(response, error);
    }
  };
}

function reserveExternalSessionsHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.externalSessionBridgeService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const reservation =
        await dependencies.externalSessionBridgeService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendExternalSessionBridgeInternalError(response, error);
    }
  };
}

function submitExternalSessionsResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.externalSessionBridgeService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseExternalSessionResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }
    try {
      const outcome =
        await dependencies.externalSessionBridgeService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendExternalSessionBridgeInternalError(response, error);
    }
  };
}

function reserveManualCompactHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.manualCompactService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }
    try {
      const reservation =
        await dependencies.manualCompactService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendManualCompactError(response, error);
    }
  };
}

function submitManualCompactResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.manualCompactService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseManualCompactResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }
    try {
      const outcome =
        await dependencies.manualCompactService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendManualCompactError(response, error);
    }
  };
}

function reserveProviderSessionCleanupHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.providerSessionCleanupService) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation =
        await dependencies.providerSessionCleanupService.reserveNext({
          userId,
          listenerInstanceId: body.listener_instance_id,
        });
      response.json({
        success: true,
        data: reservation,
      });
    } catch (error) {
      sendProviderSessionCleanupError(response, error);
    }
  };
}

function submitProviderSessionCleanupResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.providerSessionCleanupService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseProviderSessionCleanupResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.providerSessionCleanupService.complete({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          outcome:
            body.status === "success"
              ? { status: "success" }
              : {
                  status: "failure",
                  failureCode: body.failure_code,
                },
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendProviderSessionCleanupError(response, error);
    }
  };
}

function reserveNextHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const body = parseListenerBody(request.body);
    if (!body) {
      sendInvalid(response);
      return;
    }

    try {
      const reservation = await dependencies.relayService.reserveNext({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      response.json({
        success: true,
        data: reservation
          ? {
              reservationId: reservation.reservationId,
              command: reservation.command,
            }
          : null,
      });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function executionStartedHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.markExecutionStarted({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function waitRuntimeControlHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeControlService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const lease = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "RESERVATION_CONFLICT",
            message: "Native live listener lease is no longer owned by this daemon.",
          },
        });
        return;
      }

      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.once("close", onClose);
      try {
        const result =
          await dependencies.runtimeControlService.waitNextForListener({
            userId,
            listenerInstanceId: body.listener_instance_id,
            reservationId,
            timeoutMs: 25_000,
            signal: controller.signal,
          });
        if (!response.writableEnded && !controller.signal.aborted) {
          response.json({
            success: true,
            data: result,
          });
        }
      } finally {
        response.off("close", onClose);
      }
    } catch (error) {
      if (response.writableEnded) return;
      sendRuntimeControlError(response, error);
    }
  };
}

function completeRuntimeControlHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeControlService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const controlId =
      parseReservationId(request.params.controlId);
    const body = parseRuntimeControlCompletionBody(request.body);
    if (!reservationId || !controlId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeControlService.completeForListener({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          controlId,
          outcome: body.outcome,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendRuntimeControlError(response, error);
    }
  };
}

function createRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseRuntimeInteractionCreateBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const result =
        await dependencies.runtimeInteractionService.create({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          interactionId: body.interaction_id,
          kind: body.kind,
          request: body.request,
        });
      response.status(result.outcome === "created" ? 201 : 200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      sendRuntimeInteractionError(response, error);
    }
  };
}

function waitRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const interactionId =
      parseReservationId(request.params.interactionId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !interactionId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const lease = await dependencies.relayService.renewLease({
        userId,
        listenerInstanceId: body.listener_instance_id,
        dispatchTarget: "claude_code",
      });
      if (lease === "busy") {
        response.status(409).json({
          success: false,
          error: {
            code: "RESERVATION_CONFLICT",
            message: "Native live listener lease is no longer owned by this daemon.",
          },
        });
        return;
      }

      const controller = new AbortController();
      const onClose = () => controller.abort();
      response.once("close", onClose);
      try {
        const result =
          await dependencies.runtimeInteractionService.waitForListener({
            userId,
            listenerInstanceId: body.listener_instance_id,
            reservationId,
            interactionId,
            timeoutMs: 25_000,
            signal: controller.signal,
          });
        if (!response.writableEnded && !controller.signal.aborted) {
          response.json({
            success: true,
            data: result,
          });
        }
      } finally {
        response.off("close", onClose);
      }
    } catch (error) {
      if (response.writableEnded) return;
      sendRuntimeInteractionError(response, error);
    }
  };
}

function cancelRuntimeInteractionHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeInteractionService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const interactionId =
      parseReservationId(request.params.interactionId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !interactionId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeInteractionService.cancelForListener({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          interactionId,
        });
      response.json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      sendRuntimeInteractionError(response, error);
    }
  };
}

function appendRuntimeEventBatchHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId || !dependencies.runtimeEventService) return;
    const reservationId =
      parseReservationId(request.params.reservationId);
    const body = parseRuntimeEventBatchBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const outcome =
        await dependencies.runtimeEventService.appendBatch({
          userId,
          listenerInstanceId: body.listener_instance_id,
          reservationId,
          events: body.events,
        });
      response.status(outcome.created > 0 ? 201 : 200).json({
        success: true,
        data: { outcome },
      });
    } catch (error) {
      if (error instanceof NativeLiveRuntimeEventError) {
        const status =
          error.code === "INVALID_EVENT"
            ? 400
            : error.code === "RESERVATION_NOT_FOUND"
              ? 404
              : 409;
        response.status(status).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      response.status(503).json({
        success: false,
        error: {
          code: "NATIVE_LIVE_RUNTIME_EVENT_UNAVAILABLE",
          message:
            "Native live runtime event persistence is temporarily unavailable.",
        },
      });
    }
  };
}

function submitResultHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseResultBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      const finalized = await dependencies.relayService.submitResult({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
        result: body.result,
      });
      response.json({
        success: true,
        data: {
          accepted: true,
          canonicalOutcome: finalized.ok
            ? finalized.outcome
            : finalized.code,
        },
      });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function deliveryUnknownHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseListenerOnlyBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.markResultDeliveryUnknown({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function rejectReservationHandler(
  dependencies: NativeLiveRelayInternalDependencies,
): RequestHandler {
  return async (request, response) => {
    const userId = requireInternalUser(response, request.mcpUserId);
    if (!userId) return;
    const reservationId = parseReservationId(request.params.reservationId);
    const body = parseRejectBody(request.body);
    if (!reservationId || !body) {
      sendInvalid(response);
      return;
    }

    try {
      await dependencies.relayService.rejectReservation({
        userId,
        listenerInstanceId: body.listener_instance_id,
        reservationId,
        code: body.code,
      });
      response.json({ success: true, data: { accepted: true } });
    } catch (error) {
      sendRelayError(response, error);
    }
  };
}

function parseCompanionBackgroundOpportunityBody(
  value: unknown,
): {
  listener_instance_id: string;
  dispatch_target: "claude_code";
  reason: "startup" | "dirty" | "due";
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "dispatch_target",
    "reason",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || record.dispatch_target !== "claude_code"
    || (
      record.reason !== "startup"
      && record.reason !== "dirty"
      && record.reason !== "due"
    )
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    dispatch_target: "claude_code",
    reason: record.reason,
  };
}

function parseListenerBody(
  value: unknown,
): { listener_instance_id: string; dispatch_target: "claude_code" } | null {
  const record = exactRecord(value, ["listener_instance_id", "dispatch_target"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || record.dispatch_target !== "claude_code"
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    dispatch_target: "claude_code",
  };
}

function parseListenerOnlyBody(
  value: unknown,
): { listener_instance_id: string } | null {
  const record = exactRecord(value, ["listener_instance_id"]);
  if (!record || !isUuid(record.listener_instance_id)) return null;
  return { listener_instance_id: record.listener_instance_id };
}

function parseSemanticScoresBody(
  value: unknown,
): {
  listener_instance_id: string;
  scores: Record<string, number>;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "scores"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.scores
    || typeof record.scores !== "object"
    || Array.isArray(record.scores)
  ) {
    return null;
  }

  const scores = record.scores as Record<string, unknown>;
  if (
    Object.keys(scores).length === 0
    || !Object.values(scores).every(
      (score) =>
        typeof score === "number"
        && Number.isFinite(score)
        && score >= 0
        && score <= 1,
    )
  ) {
    return null;
  }

  return {
    listener_instance_id: record.listener_instance_id,
    scores: scores as Record<string, number>,
  };
}

function parseSemanticFallbackBody(
  value: unknown,
): {
  listener_instance_id: string;
  code: NativeLiveSemanticFallbackCode;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "code"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || (
      record.code !== "E5_PROVIDER_UNAVAILABLE"
      && record.code !== "E5_SCORING_FAILED"
    )
  ) {
    return null;
  }

  return {
    listener_instance_id: record.listener_instance_id,
    code: record.code,
  };
}

function parseRuntimeControlCompletionBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "applied";
        receipt: Record<string, unknown>;
      }
    | {
        status: "failed";
        failureCode: string;
      };
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "outcome",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.outcome
    || typeof record.outcome !== "object"
    || Array.isArray(record.outcome)
  ) {
    return null;
  }
  const outcome = record.outcome as Record<string, unknown>;
  if (
    outcome.status === "applied"
    && Object.keys(outcome).length === 2
    && outcome.receipt
    && typeof outcome.receipt === "object"
    && !Array.isArray(outcome.receipt)
  ) {
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "applied",
        receipt: outcome.receipt as Record<string, unknown>,
      },
    };
  }
  if (
    outcome.status === "failed"
    && Object.keys(outcome).length === 2
    && typeof outcome.failureCode === "string"
  ) {
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failed",
        failureCode: outcome.failureCode,
      },
    };
  }
  return null;
}

function parseRuntimeInteractionCreateBody(
  value: unknown,
): {
  listener_instance_id: string;
  interaction_id: string;
  kind: "permission" | "question";
  request: Record<string, unknown>;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "interaction_id",
    "kind",
    "request",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !isUuid(record.interaction_id)
    || (record.kind !== "permission" && record.kind !== "question")
    || !record.request
    || typeof record.request !== "object"
    || Array.isArray(record.request)
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    interaction_id: record.interaction_id,
    kind: record.kind,
    request: record.request as Record<string, unknown>,
  };
}

function parseRuntimeEventBatchBody(
  value: unknown,
): {
  listener_instance_id: string;
  events: Array<{
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }>;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "events",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !Array.isArray(record.events)
    || record.events.length < 1
    || record.events.length > 32
  ) {
    return null;
  }

  const events: Array<{
    sequence: number;
    event: NativeLiveNormalizedEvent;
  }> = [];
  for (const item of record.events) {
    const eventRecord = exactRecord(item, [
      "sequence",
      "event",
    ]);
    if (
      !eventRecord
      || !Number.isInteger(eventRecord.sequence)
      || (eventRecord.sequence as number) < 1
      || !eventRecord.event
      || typeof eventRecord.event !== "object"
      || Array.isArray(eventRecord.event)
    ) {
      return null;
    }
    events.push({
      sequence: eventRecord.sequence as number,
      event:
        eventRecord.event as NativeLiveNormalizedEvent,
    });
  }

  return {
    listener_instance_id: record.listener_instance_id,
    events,
  };
}

function parseProviderSessionCleanupResultBody(
  value: unknown,
):
  | {
      listener_instance_id: string;
      status: "success";
    }
  | {
      listener_instance_id: string;
      status: "failure";
      failure_code: string;
    }
  | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isUuid(record.listener_instance_id)
    || (
      record.status !== "success"
      && record.status !== "failure"
    )
  ) {
    return null;
  }

  if (record.status === "success") {
    if (
      Object.keys(record).length !== 2
      || "failure_code" in record
    ) {
      return null;
    }
    return {
      listener_instance_id: record.listener_instance_id,
      status: "success",
    };
  }

  if (
    Object.keys(record).length !== 3
    || typeof record.failure_code !== "string"
    || !record.failure_code.trim()
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    status: "failure",
    failure_code: record.failure_code,
  };
}

function parseResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  result: NativeLiveRuntimeExecutionResult;
} | null {
  const record = exactRecord(value, ["listener_instance_id", "result"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || !record.result
    || typeof record.result !== "object"
    || Array.isArray(record.result)
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    result: record.result as NativeLiveRuntimeExecutionResult,
  };
}

function parseExternalSessionResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "success";
        sessions: Array<{
          sessionId: string;
          summary: string | null;
          customTitle: string | null;
          firstPrompt: string | null;
          gitBranch: string | null;
          lastModified: number | null;
          createdAt: number | null;
          workspaceId: string | null;
          workspaceRoot: string;
        }>;
      }
    | {
        status: "failure";
        failureCode: string;
      };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isUuid(record.listener_instance_id)) return null;

  if (record.status === "failure") {
    if (
      typeof record.failure_code !== "string"
      || !record.failure_code.trim()
    ) return null;
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failure",
        failureCode: record.failure_code,
      },
    };
  }

  if (record.status !== "success" || !Array.isArray(record.sessions)) {
    return null;
  }
  const sessions = [];
  for (const item of record.sessions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.session_id !== "string"
      || !row.session_id.trim()
      || typeof row.workspace_root !== "string"
      || !row.workspace_root.trim()
      || !nullableString(row.summary)
      || !nullableString(row.custom_title)
      || !nullableString(row.first_prompt)
      || !nullableString(row.git_branch)
      || !nullableString(row.workspace_id)
      || !nullableFiniteNumberValue(row.last_modified)
      || !nullableFiniteNumberValue(row.created_at)
    ) {
      return null;
    }
    if (
      typeof row.workspace_id === "string"
      && !isUuid(row.workspace_id)
    ) {
      return null;
    }
    sessions.push({
      sessionId: row.session_id,
      summary:
        typeof row.summary === "string" ? row.summary : null,
      customTitle:
        typeof row.custom_title === "string"
          ? row.custom_title
          : null,
      firstPrompt:
        typeof row.first_prompt === "string"
          ? row.first_prompt
          : null,
      gitBranch:
        typeof row.git_branch === "string"
          ? row.git_branch
          : null,
      lastModified:
        typeof row.last_modified === "number"
          ? row.last_modified
          : null,
      createdAt:
        typeof row.created_at === "number"
          ? row.created_at
          : null,
      workspaceId:
        typeof row.workspace_id === "string"
          ? row.workspace_id
          : null,
      workspaceRoot: row.workspace_root,
    });
  }
  return {
    listener_instance_id: record.listener_instance_id,
    outcome: {
      status: "success",
      sessions,
    },
  };
}

function nullableString(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

function nullableFiniteNumberValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || (typeof value === "number" && Number.isFinite(value));
}

function parseManualCompactResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  outcome:
    | {
        status: "success";
        result: {
          providerSessionId: string;
          contextUsage: import("../domains/bridge/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null;
          boundary: Record<string, unknown> | null;
          summary: string | null;
        };
      }
    | {
        status: "failure";
        failureCode: string;
      };
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isUuid(record.listener_instance_id)) return null;

  if (record.status === "failure") {
    if (
      typeof record.failure_code !== "string"
      || !record.failure_code.trim()
    ) return null;
    return {
      listener_instance_id: record.listener_instance_id,
      outcome: {
        status: "failure",
        failureCode: record.failure_code,
      },
    };
  }

  if (
    record.status !== "success"
    || !record.result
    || typeof record.result !== "object"
    || Array.isArray(record.result)
  ) return null;
  const result = record.result as Record<string, unknown>;
  if (
    typeof result.provider_session_id !== "string"
    || !result.provider_session_id.trim()
  ) return null;

  const contextUsage =
    result.context_usage === null
      ? null
      : parseManualCompactContextUsage(result.context_usage);
  if (result.context_usage !== null && !contextUsage) return null;

  const boundary =
    result.boundary === null
      ? null
      : (
          result.boundary
          && typeof result.boundary === "object"
          && !Array.isArray(result.boundary)
            ? result.boundary as Record<string, unknown>
            : null
        );
  if (result.boundary !== null && !boundary) return null;
  if (
    result.summary !== null
    && typeof result.summary !== "string"
  ) return null;

  return {
    listener_instance_id: record.listener_instance_id,
    outcome: {
      status: "success",
      result: {
        providerSessionId: result.provider_session_id,
        contextUsage,
        boundary,
        summary:
          typeof result.summary === "string"
            ? result.summary
            : null,
      },
    },
  };
}

function parseManualCompactContextUsage(
  value: unknown,
): import("../domains/bridge/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const numberOrNull = (input: unknown): number | null | undefined =>
    input === null
      ? null
      : typeof input === "number" && Number.isFinite(input)
        ? input
        : undefined;
  const total = numberOrNull(record.total_tokens);
  const max = numberOrNull(record.max_tokens);
  const rawMax = numberOrNull(record.raw_max_tokens);
  const percentage = numberOrNull(record.percentage);
  if (
    total === undefined
    || max === undefined
    || rawMax === undefined
    || percentage === undefined
    || !Array.isArray(record.categories)
  ) return null;
  const categories = [];
  for (const item of record.categories) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const category = item as Record<string, unknown>;
    const tokens = numberOrNull(category.tokens);
    if (
      tokens === undefined
      || !(category.name === null || typeof category.name === "string")
      || !(category.kind === null || typeof category.kind === "string")
      || !(
        category.is_deferred === null
        || typeof category.is_deferred === "boolean"
      )
    ) return null;
    categories.push({
      name: category.name as string | null,
      tokens,
      kind: category.kind as string | null,
      is_deferred: category.is_deferred as boolean | null,
    });
  }
  return {
    model:
      record.model === null || typeof record.model === "string"
        ? record.model as string | null
        : null,
    total_tokens: total,
    max_tokens: max,
    raw_max_tokens: rawMax,
    percentage,
    categories,
  };
}

function parseBackgroundModelResultBody(
  value: unknown,
): {
  listener_instance_id: string;
  result: NativeLiveBackgroundModelExecutionResult;
} | null {
  const record = exactRecord(value, [
    "listener_instance_id",
    "result",
  ]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
  ) {
    return null;
  }

  try {
    return {
      listener_instance_id: record.listener_instance_id,
      result: parseNativeLiveBackgroundModelExecutionResult(
        record.result,
      ),
    };
  } catch {
    return null;
  }
}

function parseRejectBody(
  value: unknown,
): { listener_instance_id: string; code: NativeLiveDaemonRejectCode } | null {
  const record = exactRecord(value, ["listener_instance_id", "code"]);
  if (
    !record
    || !isUuid(record.listener_instance_id)
    || (
      record.code !== "INVALID_COMMAND"
      && record.code !== "EXECUTION_START_FAILED"
    )
  ) {
    return null;
  }
  return {
    listener_instance_id: record.listener_instance_id,
    code: record.code,
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== keys.length
    || actualKeys.some((key) => !keys.includes(key))
  ) {
    return null;
  }
  return record;
}

function parseReservationId(
  value: string | string[] | undefined,
): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return isUuid(id) ? id : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requireInternalUser(
  response: Response,
  userId: string | undefined,
): string | null {
  if (userId) return userId;
  response.status(401).json({
    success: false,
    error: {
      code: "UNAUTHORIZED",
      message: "A valid internal credential is required.",
    },
  });
  return null;
}

function sendRuntimeControlError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveRuntimeControlError) {
    const status =
      error.code === "CONTROL_INVALID"
        ? 400
        : error.code === "CONTROL_NOT_FOUND"
          ? 404
          : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_RUNTIME_CONTROL_UNAVAILABLE",
      message:
        "Native live runtime control is temporarily unavailable.",
    },
  });
}

function sendRuntimeInteractionError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveRuntimeInteractionError) {
    const status =
      error.code === "INTERACTION_INVALID"
        ? 400
        : error.code === "INTERACTION_NOT_FOUND"
          || error.code === "RESERVATION_NOT_FOUND"
          ? 404
          : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_RUNTIME_INTERACTION_UNAVAILABLE",
      message:
        "Native live runtime interaction is temporarily unavailable.",
    },
  });
}

function parseInternalAttachmentUploadBody(
  value: unknown,
): {
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: "image" | "file";
} | null {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  const allowed = new Set([
    "filename",
    "mime_type",
    "size_bytes",
    "sha256",
    "kind",
  ]);
  if (
    keys.length !== allowed.size
    || keys.some((key) => !allowed.has(key))
    || typeof body.filename !== "string"
    || typeof body.mime_type !== "string"
    || typeof body.size_bytes !== "number"
    || typeof body.sha256 !== "string"
    || (body.kind !== "image" && body.kind !== "file")
  ) {
    return null;
  }
  return {
    filename: body.filename,
    mime_type: body.mime_type,
    size_bytes: body.size_bytes,
    sha256: body.sha256,
    kind: body.kind,
  };
}

function sendInternalAttachmentError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveAttachmentError) {
    const status =
      error.code === "INVALID_ATTACHMENT"
        ? 400
        : error.code === "ATTACHMENT_LIMIT_EXCEEDED"
          ? 413
          : error.code === "ATTACHMENT_NOT_FOUND"
            ? 404
            : error.code === "ATTACHMENT_STORAGE_UNAVAILABLE"
              ? 503
              : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_ATTACHMENT_UNAVAILABLE",
      message: "Native live attachment storage is temporarily unavailable.",
    },
  });
}

function sendInvalid(response: Response): void {
  response.status(400).json({
    success: false,
    error: {
      code: "INVALID_NATIVE_LIVE_RELAY_REQUEST",
      message: "Native live relay request is invalid.",
    },
  });
}

function sendSemanticError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveSemanticHandshakeError) {
    const status =
      error.code === "SEMANTIC_SCORE_INVALID" ? 400 : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live semantic listener lease is not active."
            : error.code === "SEMANTIC_SCORE_INVALID"
              ? "Semantic score payload is invalid."
              : "Semantic scoring reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_SEMANTIC_UNAVAILABLE",
      message: "Native live semantic scoring is temporarily unavailable.",
    },
  });
}

function sendMindSemanticGroupingError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof MindSemanticGroupingRepositoryError) {
    const status = error.code === "SCORE_INVALID" ? 400 : 409;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Mind semantic grouping listener lease is not active."
            : error.code === "SCORE_INVALID"
              ? "Mind semantic grouping score payload is invalid."
              : "Mind semantic grouping reservation is no longer valid.",
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "MIND_SEMANTIC_GROUPING_UNAVAILABLE",
      message: "Mind semantic grouping is temporarily unavailable.",
    },
  });
}

async function bestEffortAdvanceBackgroundWorkflow(
  dependencies: NativeLiveRelayInternalDependencies,
  userId: string,
): Promise<void> {
  try {
    await dependencies.backgroundModelCoordinator?.advanceNextForUser({
      userId,
    });
  } catch {
    // A terminal result is already durable. Recovery happens on the next
    // reserve call; workflow advancement must not turn delivery into failure.
  }
}

function sendBackgroundModelError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveBackgroundModelQueueError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live background listener lease is not active."
            : "Native live background model reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_BACKGROUND_MODEL_UNAVAILABLE",
      message:
        "Native live background model queue is temporarily unavailable.",
    },
  });
}

function sendExternalSessionBridgeInternalError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveExternalSessionBridgeError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_EXTERNAL_SESSION_UNAVAILABLE",
      message: "External Claude sessions are temporarily unavailable.",
    },
  });
}

function sendManualCompactError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveManualCompactError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }
  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_MANUAL_COMPACT_UNAVAILABLE",
      message: "Manual compact is temporarily unavailable.",
    },
  });
}

function sendProviderSessionCleanupError(
  response: Response,
  error: unknown,
): void {
  if (error instanceof NativeLiveProviderSessionCleanupError) {
    response.status(409).json({
      success: false,
      error: {
        code: error.code,
        message:
          error.code === "LISTENER_NOT_ACTIVE"
            ? "Native live provider session cleanup listener lease is not active."
            : "Provider session cleanup reservation is no longer valid.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_PROVIDER_SESSION_CLEANUP_UNAVAILABLE",
      message:
        "Native live provider session cleanup is temporarily unavailable.",
    },
  });
}

function sendRelayError(response: Response, error: unknown): void {
  if (error instanceof NativeLiveBackendRelayError) {
    const status =
      error.code === "LISTENER_BUSY"
        ? 409
        : error.code === "LISTENER_NOT_ACTIVE"
          ? 409
          : error.code === "RESERVATION_CONFLICT"
            ? 409
            : 503;
    response.status(status).json({
      success: false,
      error: {
        code: error.code,
        ...(error.finalizeCode
          ? { finalizeCode: error.finalizeCode }
          : {}),
        message:
          error.code === "LISTENER_BUSY"
            ? "Another native live listener owns the active lease."
            : error.code === "LISTENER_NOT_ACTIVE"
              ? "Native live listener lease is not active."
              : error.code === "RESERVATION_CONFLICT"
                ? "Native live reservation is no longer valid."
                : "Native live result finalization was rejected.",
      },
    });
    return;
  }

  response.status(503).json({
    success: false,
    error: {
      code: "NATIVE_LIVE_RELAY_UNAVAILABLE",
      message: "Native live relay is temporarily unavailable.",
    },
  });
}
