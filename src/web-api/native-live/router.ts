import { Router } from "express";
import type { NativeLiveApiDependencies } from "./dependencies.js";
import {
  prepareNativeLiveTurnHandler,
  readNativeLiveTurnHandler,
  readNativeLiveActiveTurnHandler,
  waitNativeLiveTurnHandler,
} from "./turns.js";
import {
  createNativeLiveAttachmentUploadSlotHandler,
  completeNativeLiveAttachmentHandler,
  createNativeLiveAttachmentDownloadSlotHandler,
} from "./attachments.js";
import {
  readNativeLiveRuntimeEventsHandler,
  readNativeLiveRuntimeInteractionsHandler,
  resolveNativeLiveRuntimeInteractionHandler,
  readNativeLiveRuntimeControlsHandler,
  createNativeLiveRuntimeControlHandler,
} from "./runtime.js";
import {
  listNativeLiveConversationsHandler,
  createNativeLiveConversationHandler,
  renameNativeLiveConversationHandler,
  archiveNativeLiveConversationHandler,
  restoreNativeLiveConversationHandler,
  deleteNativeLiveConversationHandler,
  readNativeLiveCurrentPathHandler,
  readNativeLiveConversationRuntimeMetadataHandler,
} from "./conversations.js";
import {
  createNativeLiveManualCompactHandler,
  readNativeLiveManualCompactHandler,
} from "./compact.js";
import {
  createNativeLiveExternalSessionListHandler,
  readNativeLiveExternalSessionListHandler,
  createNativeLiveConversationFromClaudeSessionHandler,
  readNativeLiveConversationHistorySnapshotHandler,
} from "./external-sessions.js";

export function createNativeLiveApiRouter(
  dependencies: NativeLiveApiDependencies,
): Router {
  const router = Router();
  router.post("/prepare", prepareNativeLiveTurnHandler(dependencies));
  if (dependencies.attachmentService) {
    router.post(
      "/attachments/upload-slots",
      createNativeLiveAttachmentUploadSlotHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/complete",
      completeNativeLiveAttachmentHandler(dependencies),
    );
    router.post(
      "/attachments/:attachmentId/download-slot",
      createNativeLiveAttachmentDownloadSlotHandler(dependencies),
    );
  }
  router.get("/turns/:prepareId", readNativeLiveTurnHandler(dependencies));
  router.get(
    "/conversations/:conversationId/active-turn",
    readNativeLiveActiveTurnHandler(dependencies),
  );
  if (dependencies.turnWaitService) {
    router.post(
      "/turns/:prepareId/wait",
      waitNativeLiveTurnHandler(dependencies),
    );
  }
  if (dependencies.runtimeEventService) {
    router.get(
      "/turns/:prepareId/events",
      readNativeLiveRuntimeEventsHandler(dependencies),
    );
  }
  if (dependencies.runtimeInteractionService) {
    router.get(
      "/turns/:prepareId/interactions",
      readNativeLiveRuntimeInteractionsHandler(dependencies),
    );
    router.post(
      "/turns/:prepareId/interactions/:interactionId/respond",
      resolveNativeLiveRuntimeInteractionHandler(dependencies),
    );
  }
  if (dependencies.runtimeControlService) {
    router.get(
      "/turns/:prepareId/controls",
      readNativeLiveRuntimeControlsHandler(dependencies),
    );
    router.post(
      "/turns/:prepareId/controls",
      createNativeLiveRuntimeControlHandler(dependencies),
    );
  }
  if (dependencies.conversationService) {
    router.get(
      "/conversations",
      listNativeLiveConversationsHandler(dependencies),
    );
    router.post(
      "/conversations",
      createNativeLiveConversationHandler(dependencies),
    );
    router.patch(
      "/conversations/:conversationId",
      renameNativeLiveConversationHandler(dependencies),
    );
    router.post(
      "/conversations/:conversationId/archive",
      archiveNativeLiveConversationHandler(dependencies),
    );
    router.post(
      "/conversations/:conversationId/restore",
      restoreNativeLiveConversationHandler(dependencies),
    );
    router.delete(
      "/conversations/:conversationId",
      deleteNativeLiveConversationHandler(dependencies),
    );
  }
  if (dependencies.currentPathReader) {
    router.get(
      "/conversations/:conversationId/current-path",
      readNativeLiveCurrentPathHandler(dependencies),
    );
  }
  if (dependencies.conversationRuntimeMetadataReader) {
    router.get(
      "/conversations/:conversationId/runtime-metadata",
      readNativeLiveConversationRuntimeMetadataHandler(dependencies),
    );
  }
  if (dependencies.manualCompactService) {
    router.post(
      "/conversations/:conversationId/compact",
      createNativeLiveManualCompactHandler(dependencies),
    );
    router.get(
      "/manual-compacts/:requestId",
      readNativeLiveManualCompactHandler(dependencies),
    );
  }
  if (dependencies.externalSessionBridgeService) {
    router.post(
      "/external-sessions/requests",
      createNativeLiveExternalSessionListHandler(dependencies),
    );
    router.get(
      "/external-sessions/requests/:requestId",
      readNativeLiveExternalSessionListHandler(dependencies),
    );
    router.post(
      "/conversations/from-claude-session",
      createNativeLiveConversationFromClaudeSessionHandler(dependencies),
    );
    router.get(
      "/conversations/:conversationId/history-snapshot",
      readNativeLiveConversationHistorySnapshotHandler(dependencies),
    );
  }
  return router;
}
