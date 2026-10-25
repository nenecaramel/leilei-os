



import type {
  NativeLiveRuntimeCommand,
  NativeLiveRuntimeExecutionResult,
} from "../protocol/native-live-runtime-protocol.js";



import type {
  NativeLiveSemanticFallbackCode,
  NativeLiveSemanticScoringReservation,
} from "../mind/native-live-semantic-handshake.js";

import type {
  NativeLiveBackgroundModelCommand,
  NativeLiveBackgroundModelExecutionResult,
} from "../background/native-live-background-model-protocol.js";

import type {
  NativeLiveNormalizedEvent,
} from "../../conversation/native-live-conversation-orchestrator.js";

import type {
  NativeLiveMacActiveTurnController,
} from "./native-live-mac-claude-transport.js";

import type {
  NativeLiveManualCompactReservation,
  NativeLiveManualCompactSuccess,
} from "../turn/native-live-manual-compact.js";

export type NativeLiveDaemonLeaseState = "acquired" | "renewed" | "busy";

export type NativeLiveDaemonReservation = {
  reservationId: string;
  command: NativeLiveRuntimeCommand;
};

export type NativeLiveProviderSessionCleanupReservation = {
  reservationId: string;
  providerSessionId: string;
  effectiveWorkingDirectory: string | null;
};

export type NativeLiveBackgroundModelReservation = {
  reservationId: string;
  command: NativeLiveBackgroundModelCommand;
};

export type NativeLiveRuntimeControlReservation = {
  controlId: string;
  kind: "mid_turn_input" | "interrupt";
  payload: Record<string, unknown>;
};

export type NativeLiveDaemonRejectCode =
  | "INVALID_COMMAND"
  | "EXECUTION_START_FAILED";

export type NativeLiveResultSubmissionReceipt = {
  canonicalOutcome: string | null;
  nativeResumeCheckpointId?: string;
};

export type NativeLiveDaemonRunOutcome =
  | { outcome: "result_recovery_required"; reservationId: string; conversationId: string; code: "RESERVATION_CONFLICT" }
  | { outcome: "idle" }
  | { outcome: "busy" }
  | {
      outcome: "semantic_completed";
      reservationId: string;
    }
  | {
      outcome: "semantic_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "completed";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
      relayErrorCode?: string;
      finalizeCode?: string;
      canonicalOutcome?: string;
    }
  | {
      outcome: "rejected";
      reservationId: string;
      code: NativeLiveDaemonRejectCode;
    }
  | {
      outcome: "delivery_unknown";
      reservationId: string;
      result: NativeLiveRuntimeExecutionResult;
      eventDeliveryFailures?: number;
    }
  | {
      outcome: "external_session_list_completed";
      reservationId: string;
    }
  | {
      outcome: "external_session_list_failed";
      reservationId: string;
    }
  | {
      outcome: "external_session_list_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_completed";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_failed";
      reservationId: string;
    }
  | {
      outcome: "manual_compact_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_completed";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_failed";
      reservationId: string;
    }
  | {
      outcome: "provider_session_cleanup_delivery_unknown";
      reservationId: string;
    }
  | {
      outcome: "background_completed";
      reservationId: string;
      result: NativeLiveBackgroundModelExecutionResult;
    }
  | {
      outcome: "background_delivery_unknown";
      reservationId: string;
      result: NativeLiveBackgroundModelExecutionResult;
    };

export interface NativeLiveMacDaemonRelayClient {
  createAttachmentDownloadSlot?(input: {
    attachmentId: string;
  }): Promise<{
    url: string;
    method: "GET";
    headers: Record<string, string>;
    attachment: {
      attachmentId: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      kind: "image" | "file";
    };
  }>;

  reserveExternalSessions?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<{ reservationId: string } | null>;

  submitExternalSessionsResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
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
            workingDirectory: string;
          }>;
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<void>;

  reserveManualCompact?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveManualCompactReservation | null>;

  submitManualCompactResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          result: NativeLiveManualCompactSuccess;
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<void>;

  reserveProviderSessionCleanup?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveProviderSessionCleanupReservation | null>;

  submitProviderSessionCleanupResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | { status: "success" }
      | { status: "failure"; failureCode: string };
  }): Promise<void>;

  reserveBackgroundModel?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveBackgroundModelReservation | null>;

  submitBackgroundModelResult?(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveBackgroundModelExecutionResult;
  }): Promise<void>;

  reserveSemanticScoring?(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveSemanticScoringReservation | null>;

  submitSemanticScores?(input: {
    listenerInstanceId: string;
    reservationId: string;
    scores: Record<string, number>;
  }): Promise<void>;

  submitSemanticFallback?(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<void>;

  renewLease(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonLeaseState>;

  reserveNext(input: {
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
    persistentSessions?: boolean;
    resultOutboxIdle?: boolean;
  }): Promise<NativeLiveDaemonReservation | null>;

  checkTaskAdmission?(input: { listenerInstanceId:string;prepareId:string;providerSessionId:string }):Promise<boolean>;
  bindInput?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand;
    phase: "queued" | "started"; commandUuid: string }): Promise<{
      userMessageId: string; parentProviderCheckpointId: string | null;
    } | null>;
  checkExecutionAdmission?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand }): Promise<boolean>;
  renewExecutionLease?(input: { listenerInstanceId: string; command: NativeLiveRuntimeCommand }): Promise<boolean>;

  markExecutionStarted(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void>;

  appendRuntimeEvents?(input: {
    listenerInstanceId: string;
    reservationId: string;
    events: ReadonlyArray<{
      sequence: number;
      event: NativeLiveNormalizedEvent;
    }>;
  }): Promise<void>;

  requestRuntimeInteraction?(input: {
    listenerInstanceId: string;
    reservationId: string;
    kind: "permission" | "question";
    request: Record<string, unknown>;
    signal: AbortSignal | null;
  }): Promise<Record<string, unknown>>;

  waitRuntimeControl?(input: {
    listenerInstanceId: string;
    reservationId: string;
    signal?: AbortSignal | null;
  }): Promise<NativeLiveRuntimeControlReservation | null>;

  completeRuntimeControl?(input: {
    listenerInstanceId: string;
    reservationId: string;
    controlId: string;
    outcome:
      | {
          status: "applied";
          receipt: Record<string, unknown>;
        }
      | {
          status: "failed";
          failureCode: string;
        };
  }): Promise<void>;

  submitResult(input: {
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<NativeLiveResultSubmissionReceipt | void>;

  markResultDeliveryUnknown(input: {
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void>;

  rejectReservation(input: {
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<void>;
}

export interface NativeLivePreparedCommandExecutor {
  execute(
    command: unknown,
    options?: {
      onNormalizedEvent?: (
        event: NativeLiveNormalizedEvent,
      ) => void | Promise<void>;
      permissionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      questionHandler?: (
        request: Record<string, unknown>,
        context: { signal: AbortSignal | null },
      ) => Promise<Record<string, unknown>>;
      controlPump?: (
        controller: NativeLiveMacActiveTurnController,
        context: { signal: AbortSignal },
      ) => Promise<void>;
    },
  ): Promise<NativeLiveRuntimeExecutionResult>;
}

export interface NativeLiveDaemonIdleOpportunity {
  // Scheduling results are intentionally ignored; completion is still awaited.
  offer(): void | Promise<unknown>;
}

export interface NativeLiveExternalSessionExecutor {
  listExternalSessions(): Promise<Array<{
    sessionId: string;
    summary: string | null;
    customTitle: string | null;
    firstPrompt: string | null;
    gitBranch: string | null;
    lastModified: number | null;
    createdAt: number | null;
    workingDirectory: string;
  }>>;
}

export interface NativeLiveManualCompactExecutor {
  compactSession(
    sessionId: string,
    expectedWorkingDirectory: string | null,
    providerCheckpointId?: string | null,
  ): Promise<{
    providerSessionId: string;
    providerCheckpointId?: string | null;
    contextUsage?: import("../protocol/native-live-runtime-protocol.js").NativeLiveRuntimeContextUsage | null;
    compaction?: {
      boundary?: Record<string, unknown> | null;
      postCompact?: Array<{
        summary?: string | null;
      }>;
    };
  }>;
}

export interface NativeLiveProviderSessionCleanupExecutor {
  deleteSession(
    sessionId: string,
    expectedWorkingDirectory: string | null,
  ): Promise<void>;
}

export interface NativeLiveBackgroundModelExecutor {
  execute(
    command: unknown,
  ): Promise<NativeLiveBackgroundModelExecutionResult>;
}
