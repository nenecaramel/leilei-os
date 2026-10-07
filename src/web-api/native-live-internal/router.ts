import { Router } from "express";
import type { NativeLiveRelayInternalDependencies } from "./dependencies.js";
import {
  renewLeaseHandler,
  waitForWorkHandler,
  reserveNextHandler,
  executionStartedHandler,
  submitResultHandler,
  deliveryUnknownHandler,
  rejectReservationHandler,
} from "./execution.js";
import {
  reserveSemanticHandler,
  submitSemanticScoresHandler,
  submitSemanticFallbackHandler,
} from "./semantic.js";
import {
  companionBackgroundOpportunityHandler,
  reserveBackgroundModelHandler,
  submitBackgroundModelResultHandler,
} from "./background.js";
import {
  reserveManualCompactHandler,
  submitManualCompactResultHandler,
  reserveClaudeHandoffHandler,
  submitClaudeHandoffResultHandler,
  reserveExternalSessionsHandler,
  submitExternalSessionsResultHandler,
  reserveProviderSessionCleanupHandler,
  submitProviderSessionCleanupResultHandler,
} from "./sessions.js";
import {
  createInternalAttachmentUploadSlotHandler,
  completeInternalAttachmentUploadHandler,
  createInternalAttachmentDownloadSlotHandler,
} from "./attachments.js";
import {
  saveAlbumPhotoHandler,
  searchAlbumPhotosHandler,
  viewAlbumPhotoHandler,
  sendAlbumPhotoHandler,
} from "./album.js";
import { appendRuntimeEventBatchHandler } from "./runtime-events.js";
import {
  createRuntimeInteractionHandler,
  waitRuntimeInteractionHandler,
  cancelRuntimeInteractionHandler,
} from "./interactions.js";
import {
  waitRuntimeControlHandler,
  completeRuntimeControlHandler,
} from "./controls.js";
import {
  readSilenceWakeScheduleHandler,
  fireSilenceWakeHandler,
} from "./silence-wake.js";

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
  if (dependencies.companionBackgroundOpportunity) {
    router.post(
      "/background/opportunity",
      companionBackgroundOpportunityHandler(dependencies),
    );
  }
  if (dependencies.silenceWakeService) {
    router.post(
      "/silence-wake/schedule",
      readSilenceWakeScheduleHandler(dependencies),
    );
    router.post(
      "/silence-wake/fire",
      fireSilenceWakeHandler(dependencies),
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
  }
  if (dependencies.claudeHandoffService) {
    router.post(
      "/claude-handoff/reserve",
      reserveClaudeHandoffHandler(dependencies),
    );
    router.post(
      "/claude-handoff/reservations/:reservationId/result",
      submitClaudeHandoffResultHandler(dependencies),
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
  if (dependencies.photoAlbumService) {
    router.post(
      "/album/photos/save",
      saveAlbumPhotoHandler(dependencies),
    );
    router.post(
      "/album/photos/search",
      searchAlbumPhotosHandler(dependencies),
    );
    router.post(
      "/album/photos/:photoId/view",
      viewAlbumPhotoHandler(dependencies),
    );
  }
  if (dependencies.photoAlbumSender) {
    router.post(
      "/album/photos/:photoId/send",
      sendAlbumPhotoHandler(dependencies),
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
