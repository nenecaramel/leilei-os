import type { NativeLiveBackendRelayService } from "../../domains/bridge/relay/native-live-backend-relay.js";
import type { NativeLiveSemanticHandshakeService } from "../../domains/bridge/mind/native-live-semantic-handshake.js";
import type { NativeLiveBackgroundModelQueueService } from "../../domains/bridge/background/native-live-background-model-queue.js";
import type { NativeLiveBackgroundWorkflowCoordinator } from "../../domains/bridge/background/native-live-background-workflow-coordinator.js";
import type { NativeLiveRuntimeEventService } from "../../domains/bridge/runtime-interaction/native-live-runtime-event-stream.js";
import type { NativeLiveRuntimeInteractionService } from "../../domains/bridge/runtime-interaction/native-live-runtime-interaction.js";
import type { NativeLiveRuntimeControlService } from "../../domains/bridge/runtime-interaction/native-live-runtime-control.js";
import type { CompanionBackgroundOpportunityService } from "../../domains/runtime/background/companion-background-opportunity.js";
import type { NativeLiveWorkWaitService } from "../../domains/bridge/relay/native-live-work-wake.js";
import type { NativeLiveProviderSessionCleanupService } from "../../domains/bridge/provider-session/native-live-provider-session-cleanup.js";
import type { NativeLiveManualCompactService } from "../../domains/bridge/turn/native-live-manual-compact.js";
import type { NativeLiveExternalSessionBridgeService } from "../../domains/bridge/provider-session/native-live-external-session-bridge.js";
import type { NativeLiveAttachmentService } from "../../domains/bridge/attachment/native-live-attachment-service.js";
import type { ClaudePhotoAlbumService } from "../../domains/album/claude-photo-album-service.js";
import type { ClaudeAlbumPhotoAttachmentSender } from "../../domains/album/claude-photo-album-output-sender.js";

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
  backgroundModelService?: Pick<
    NativeLiveBackgroundModelQueueService,
    "reserveNext" | "submitResult"
  >;
  backgroundModelCoordinator?: Pick<
    NativeLiveBackgroundWorkflowCoordinator,
    "advanceNextForUser"
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
  photoAlbumService?: Pick<
    ClaudePhotoAlbumService,
    "savePhoto" | "searchPhotos" | "createPhotoDownload"
  >;
  photoAlbumSender?: Pick<
    ClaudeAlbumPhotoAttachmentSender,
    "sendPhoto"
  >;
};
