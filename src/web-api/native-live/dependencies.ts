import type { NativeLiveRelayPrepareResult } from "../../domains/bridge/native-live-backend-relay-prepare.js";
import type { NativeLiveBackendTurnReadModel } from "../../domains/bridge/native-live-backend-turn-repository.js";
import type { NativeLiveBackendRelayService } from "../../domains/bridge/native-live-backend-relay.js";
import type { NativeLiveCurrentPathReader } from "../../domains/conversation/native-live-current-path-read-repository.js";
import type { NativeLiveConversationService } from "../../domains/conversation/native-live-conversation-service.js";
import type { NativeLiveConversationRuntimeMetadataReader } from "../../domains/conversation/native-live-conversation-runtime-metadata.js";
import type { NativeLiveRuntimeEventService } from "../../domains/bridge/native-live-runtime-event-stream.js";
import type { NativeLiveRuntimeInteractionService } from "../../domains/bridge/native-live-runtime-interaction.js";
import type { NativeLiveRuntimeControlService } from "../../domains/bridge/native-live-runtime-control.js";
import type { NativeLiveTurnWaitService } from "../../domains/bridge/native-live-turn-wait.js";
import type { NativeLiveManualCompactService } from "../../domains/bridge/native-live-manual-compact.js";
import type { NativeLiveExternalSessionBridgeService } from "../../domains/bridge/native-live-external-session-bridge.js";
import type { NativeLiveAttachmentService } from "../../domains/bridge/native-live-attachment-service.js";

export type NativeLiveApiDependencies = {
  coordinator: {
    prepare(
      userId: string,
      rawRequest: unknown,
    ): Promise<NativeLiveRelayPrepareResult>;
  };
  relayService: Pick<NativeLiveBackendRelayService, "enqueuePreparation">;
  turnReader: {
    readTurn(input: {
      userId: string;
      prepareId: string;
    }): Promise<NativeLiveBackendTurnReadModel | null>;
    readActiveTurn?(input: {
      userId: string;
      conversationId: string;
    }): Promise<NativeLiveBackendTurnReadModel | null>;
  };
  turnWaitService?: Pick<NativeLiveTurnWaitService, "wait">;
  currentPathReader?: NativeLiveCurrentPathReader;
  conversationRuntimeMetadataReader?:
    NativeLiveConversationRuntimeMetadataReader;
  conversationService?: Pick<
    NativeLiveConversationService,
    "listConversations" | "listConversationPage" | "createConversation" | "renameConversation" | "archiveConversation" | "restoreConversation" | "deleteConversation"
  >;
  runtimeEventService?: Pick<
    NativeLiveRuntimeEventService,
    "list"
  >;
  runtimeInteractionService?: Pick<
    NativeLiveRuntimeInteractionService,
    "listForUser" | "resolve"
  >;
  runtimeControlService?: Pick<
    NativeLiveRuntimeControlService,
    "createForUser" | "listForUser"
  >;
  manualCompactService?: Pick<
    NativeLiveManualCompactService,
    "create" | "read"
  >;
  externalSessionBridgeService?: Pick<
    NativeLiveExternalSessionBridgeService,
    "createListRequest" | "readListRequest" | "createConversationFromSession" | "readConversationHistorySnapshot"
  >;
  attachmentService?: NativeLiveAttachmentService;
};
