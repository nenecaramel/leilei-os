import type {
  NativeLiveDaemonRunOutcome,
  NativeLiveMacDaemonRelayClient,
  NativeLiveExternalSessionExecutor,
  NativeLiveManualCompactExecutor,
  NativeLiveProviderSessionCleanupExecutor,
  NativeLiveBackgroundModelExecutor,
} from "./native-live-mac-daemon-contract.js";
import type { NativeLiveMacPersistentExecutor } from "./native-live-mac-persistent-executor.js";

/** Runs only after foreground and semantic queues are empty, in existing priority order. */
export async function runDaemonMaintenance(dependencies: {
  listenerInstanceId: string;
  relay: NativeLiveMacDaemonRelayClient;
  externalSessionExecutor: NativeLiveExternalSessionExecutor | null;
  manualCompactExecutor: NativeLiveManualCompactExecutor | null;
  providerSessionCleanupExecutor: NativeLiveProviderSessionCleanupExecutor | null;
  backgroundModelExecutor: NativeLiveBackgroundModelExecutor | null;
  persistentExecutor: Partial<Pick<NativeLiveMacPersistentExecutor, "retireSession">> | null;
}): Promise<NativeLiveDaemonRunOutcome | null> {
        if (
          dependencies.externalSessionExecutor
          && dependencies.relay.reserveExternalSessions
          && dependencies.relay.submitExternalSessionsResult
        ) {
          const external =
            await dependencies.relay.reserveExternalSessions({
              listenerInstanceId: dependencies.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (external) {
            let sessions;
            try {
              sessions =
                await dependencies.externalSessionExecutor
                  .listExternalSessions();
            } catch (error) {
              try {
                await dependencies.relay.submitExternalSessionsResult({
                  listenerInstanceId: dependencies.listenerInstanceId,
                  reservationId: external.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode:
                      externalSessionFailureCode(error),
                  },
                });
              } catch {
                return {
                  outcome:
                    "external_session_list_delivery_unknown",
                  reservationId: external.reservationId,
                };
              }
              return {
                outcome: "external_session_list_failed",
                reservationId: external.reservationId,
              };
            }

            try {
              await dependencies.relay.submitExternalSessionsResult({
                listenerInstanceId: dependencies.listenerInstanceId,
                reservationId: external.reservationId,
                outcome: {
                  status: "success",
                  sessions,
                },
              });
            } catch {
              return {
                outcome:
                  "external_session_list_delivery_unknown",
                reservationId: external.reservationId,
              };
            }
            return {
              outcome: "external_session_list_completed",
              reservationId: external.reservationId,
            };
          }
        }

        if (
          dependencies.manualCompactExecutor
          && dependencies.relay.reserveManualCompact
          && dependencies.relay.submitManualCompactResult
        ) {
          const compact =
            await dependencies.relay.reserveManualCompact({
              listenerInstanceId: dependencies.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (compact) {
            let result;
            try {
              await dependencies.persistentExecutor?.retireSession?.(compact.providerSessionId);
              result =
                await dependencies.manualCompactExecutor.compactSession(
                  compact.providerSessionId,
                  compact.effectiveWorkingDirectory,
                  compact.providerCheckpointId ?? null,
                );
            } catch (error) {
              try {
                await dependencies.relay.submitManualCompactResult({
                  listenerInstanceId: dependencies.listenerInstanceId,
                  reservationId: compact.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode:
                      manualCompactFailureCode(error),
                  },
                });
              } catch {
                return {
                  outcome: "manual_compact_delivery_unknown",
                  reservationId: compact.reservationId,
                };
              }
              return {
                outcome: "manual_compact_failed",
                reservationId: compact.reservationId,
              };
            }

            const summary =
              result.compaction?.postCompact
                ?.map((item) => item.summary ?? null)
                .filter(
                  (value): value is string =>
                    typeof value === "string"
                    && value.trim().length > 0,
                )
                .at(-1) ?? null;
            try {
              await dependencies.relay.submitManualCompactResult({
                listenerInstanceId: dependencies.listenerInstanceId,
                reservationId: compact.reservationId,
                outcome: {
                  status: "success",
                  result: {
                    providerSessionId:
                      result.providerSessionId,
                    providerCheckpointId: result.providerCheckpointId ?? null,
                    contextUsage:
                      result.contextUsage ?? null,
                    boundary:
                      result.compaction?.boundary ?? null,
                    summary,
                  },
                },
              });
            } catch {
              return {
                outcome: "manual_compact_delivery_unknown",
                reservationId: compact.reservationId,
              };
            }
            return {
              outcome: "manual_compact_completed",
              reservationId: compact.reservationId,
            };
          }
        }

        if (
          dependencies.providerSessionCleanupExecutor
          && dependencies.relay.reserveProviderSessionCleanup
          && dependencies.relay.submitProviderSessionCleanupResult
        ) {
          const cleanup =
            await dependencies.relay.reserveProviderSessionCleanup({
              listenerInstanceId: dependencies.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (cleanup) {
            try {
              await dependencies.persistentExecutor?.retireSession?.(cleanup.providerSessionId);
              await dependencies.providerSessionCleanupExecutor.deleteSession(
                cleanup.providerSessionId,
                cleanup.effectiveWorkingDirectory,
              );
            } catch {
              try {
                await dependencies.relay.submitProviderSessionCleanupResult({
                  listenerInstanceId: dependencies.listenerInstanceId,
                  reservationId: cleanup.reservationId,
                  outcome: {
                    status: "failure",
                    failureCode: "DELETE_SESSION_FAILED",
                  },
                });
              } catch {
                return {
                  outcome:
                    "provider_session_cleanup_delivery_unknown",
                  reservationId: cleanup.reservationId,
                };
              }
              return {
                outcome: "provider_session_cleanup_failed",
                reservationId: cleanup.reservationId,
              };
            }

            try {
              await dependencies.relay.submitProviderSessionCleanupResult({
                listenerInstanceId: dependencies.listenerInstanceId,
                reservationId: cleanup.reservationId,
                outcome: { status: "success" },
              });
            } catch {
              return {
                outcome:
                  "provider_session_cleanup_delivery_unknown",
                reservationId: cleanup.reservationId,
              };
            }
            return {
              outcome: "provider_session_cleanup_completed",
              reservationId: cleanup.reservationId,
            };
          }
        }

        if (
          dependencies.backgroundModelExecutor
          && dependencies.relay.reserveBackgroundModel
          && dependencies.relay.submitBackgroundModelResult
        ) {
          const background =
            await dependencies.relay.reserveBackgroundModel({
              listenerInstanceId: dependencies.listenerInstanceId,
              dispatchTarget: "claude_code",
            });
          if (background) {
            const result =
              await dependencies.backgroundModelExecutor.execute(
                background.command,
              );
            try {
              await dependencies.relay.submitBackgroundModelResult({
                listenerInstanceId: dependencies.listenerInstanceId,
                reservationId: background.reservationId,
                result,
              });
            } catch {
              return {
                outcome: "background_delivery_unknown",
                reservationId: background.reservationId,
                result,
              };
            }
            return {
              outcome: "background_completed",
              reservationId: background.reservationId,
              result,
            };
          }
        }

  return null;
}

function externalSessionFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "SESSION_LIST_FAILED";
}

function manualCompactFailureCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "runtimeCode" in error
    && typeof (error as { runtimeCode?: unknown }).runtimeCode === "string"
  ) {
    return (error as { runtimeCode: string }).runtimeCode;
  }
  return "COMPACT_FAILED";
}
