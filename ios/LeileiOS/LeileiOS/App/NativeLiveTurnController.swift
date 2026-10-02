import Foundation

extension AppModel {
    func sendNativeLiveMessage(
        _ text: String,
        attachmentIDs: [String] = [],
        workspaceID: String? = nil,
        execution: NativeLiveExecutionSelection? = nil
    ) async throws {
        guard isAuthenticated,
              !chatSendInFlight,
              let conversationID = activeNativeLiveConversationID,
              let snapshot = nativeLiveCurrentPath,
              snapshot.conversationId.caseInsensitiveCompare(
                conversationID.uuidString
              ) == .orderedSame else {
            throw NativeLiveSendError.notReady
        }

        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard normalized.count <= 4_000,
              !normalized.isEmpty || !attachmentIDs.isEmpty else {
            throw NativeLiveSendError.invalidText
        }

        chatSendInFlight = true
        chatSendState = .sending
        defer {
            chatSendInFlight = false
        }

        do {
            let prepared = try await api.prepareNativeLiveSend(
                conversationID: conversationID,
                expectedHeadMessageID: snapshot.currentHeadMessageId,
                text: normalized,
                attachmentIDs: attachmentIDs,
                workspaceID: workspaceID,
                execution: execution
            )

            guard prepared.conversationId.caseInsensitiveCompare(
                conversationID.uuidString
            ) == .orderedSame else {
                throw LeileiAPIError.invalidResponse
            }
            if let workspaceID = prepared.workspaceId {
                activeNativeLiveWorkspaceID = workspaceID
            }
            if let root = prepared.expectedWorkspaceRoot {
                activeNativeLiveWorkspaceRoot = root
            }

            try await completePreparedNativeLiveTurn(
                prepared,
                conversationID: conversationID
            )

            await refreshNativeLiveConversations()
            chatSendState = .idle
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.unauthorized
        } catch let error as LeileiAPIError {
            if case .backend(_, let code, _) = error,
               code == "STALE_HEAD" {
                await refreshNativeLiveCurrentPath(force: true)
            }
            chatSendState = .failed
            throw error
        } catch {
            chatSendState = .failed
            throw error
        }
    }

    func retryNativeLiveMessage(
        targetUserMessageID: String,
        execution: NativeLiveExecutionSelection? = nil
    ) async throws {
        guard isAuthenticated,
              !chatSendInFlight,
              let conversationID = activeNativeLiveConversationID,
              let snapshot = nativeLiveCurrentPath,
              snapshot.conversationId.caseInsensitiveCompare(
                conversationID.uuidString
              ) == .orderedSame,
              snapshot.messages.contains(where: {
                  $0.id == targetUserMessageID
                      && $0.role == "user"
              }) else {
            throw NativeLiveSendError.notReady
        }

        chatSendInFlight = true
        chatSendState = .sending
        defer {
            chatSendInFlight = false
        }

        do {
            let prepared = try await api.prepareNativeLiveRetry(
                conversationID: conversationID,
                targetUserMessageID: targetUserMessageID,
                execution: execution
            )

            try await completePreparedNativeLiveTurn(
                prepared,
                conversationID: conversationID
            )
            chatSendState = .idle
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.unauthorized
        } catch {
            chatSendState = .failed
            throw error
        }
    }

    func editNativeLiveMessage(
        targetUserMessageID: String,
        text: String,
        attachmentIDs: [String]? = nil,
        execution: NativeLiveExecutionSelection? = nil
    ) async throws {
        guard isAuthenticated,
              !chatSendInFlight,
              let conversationID = activeNativeLiveConversationID,
              let snapshot = nativeLiveCurrentPath,
              snapshot.conversationId.caseInsensitiveCompare(
                conversationID.uuidString
              ) == .orderedSame,
              snapshot.messages.contains(where: {
                  $0.id == targetUserMessageID
                      && $0.role == "user"
              }) else {
            throw NativeLiveSendError.notReady
        }

        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let targetHasAttachment =
            snapshot.messages
                .first(where: {
                    $0.id == targetUserMessageID
                        && $0.role == "user"
                })?
                .blocks
                .contains(where: { $0.kind == "attachment" })
            == true
        let editHasAttachment =
            attachmentIDs == nil
                ? targetHasAttachment
                : attachmentIDs?.isEmpty == false
        guard normalized.count <= 4_000,
              !normalized.isEmpty || editHasAttachment else {
            throw NativeLiveSendError.invalidText
        }

        chatSendInFlight = true
        chatSendState = .sending
        defer {
            chatSendInFlight = false
        }

        do {
            let prepared = try await api.prepareNativeLiveEdit(
                conversationID: conversationID,
                targetUserMessageID: targetUserMessageID,
                text: normalized,
                attachmentIDs: attachmentIDs,
                execution: execution
            )

            try await completePreparedNativeLiveTurn(
                prepared,
                conversationID: conversationID
            )
            chatSendState = .idle
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            chatSendState = .failed
            throw LeileiAPIError.unauthorized
        } catch {
            chatSendState = .failed
            throw error
        }
    }

    func recoverActiveNativeLiveTurn() async {
        guard isAuthenticated,
              !chatSendInFlight,
              chatSendState != .sending,
              nativeLiveRuntimeSurface == nil,
              let conversationID = activeNativeLiveConversationID else {
            return
        }

        do {
            guard let turn =
                    try await api.nativeLiveActiveTurn(
                        conversationID: conversationID
                    ),
                  turn.canonicalStatus == "prepared" else {
                return
            }

            chatSendState = .sending
            beginNativeLiveRuntimeObservation(
                prepareID: turn.prepareId,
                conversationID: conversationID
            )
            var shouldStopRuntimeObservation = true
            defer {
                if shouldStopRuntimeObservation {
                    stopNativeLiveRuntimeObservation(
                        prepareID: turn.prepareId
                    )
                }
            }

            do {
                try await waitForNativeLiveTurn(
                    prepareID: turn.prepareId,
                    conversationID: conversationID
                )
                shouldStopRuntimeObservation =
                    !await continueNativeLiveRuntimeObservationForBackgroundTasks(
                        prepareID: turn.prepareId,
                        conversationID: conversationID
                    )
                await refreshNativeLiveCurrentPath(force: true)
                scheduleCurrentHeadMindWriteRefresh()
                chatSendState = .idle
            } catch is CancellationError {
                chatSendState = .idle
            } catch {
                chatSendState = .failed
            }
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            // Recovery is fail-soft; normal conversation reads still work.
        }
    }

    private func completePreparedNativeLiveTurn(
        _ prepared: NativeLivePrepareResult,
        conversationID: UUID
    ) async throws {
        guard prepared.conversationId.caseInsensitiveCompare(
            conversationID.uuidString
        ) == .orderedSame else {
            throw LeileiAPIError.invalidResponse
        }

        beginNativeLiveRuntimeObservation(
            prepareID: prepared.prepareId,
            conversationID: conversationID
        )
        var shouldStopRuntimeObservation = true
        defer {
            if shouldStopRuntimeObservation {
                stopNativeLiveRuntimeObservation(
                    prepareID: prepared.prepareId
                )
            }
        }

        try await waitForNativeLiveTurn(
            prepareID: prepared.prepareId,
            conversationID: conversationID
        )
        shouldStopRuntimeObservation =
            !await continueNativeLiveRuntimeObservationForBackgroundTasks(
                prepareID: prepared.prepareId,
                conversationID: conversationID
            )
        await refreshNativeLiveCurrentPath(force: true)
        scheduleCurrentHeadMindWriteRefresh()
    }

    private func waitForNativeLiveTurn(
        prepareID: String,
        conversationID: UUID
    ) async throws {
        // Backend holds each bounded completion wait, but the durable
        // prepare itself has no client-side five-minute expiry. Keep renewing
        // the same prepare id until it reaches a terminal state or this task
        // is explicitly cancelled.
        while !Task.isCancelled {
            try Task.checkCancellation()

            do {
                let result = try await api.waitNativeLiveTurn(
                    prepareID: prepareID
                )

                switch result {
                case .timeout:
                    continue

                case .terminal(let turn):
                    guard turn.conversationId.caseInsensitiveCompare(
                        conversationID.uuidString
                    ) == .orderedSame else {
                        throw LeileiAPIError.invalidResponse
                    }

                    if turn.canonicalStatus == "finalized_success" {
                        nativeLiveRuntimeMetadata = turn.runtimeMetadata
                        activeNativeLiveWorkspaceID = turn.workspaceId
                        activeNativeLiveWorkspaceRoot =
                            turn.expectedWorkspaceRoot
                        if let metadata = turn.runtimeMetadata {
                            nativeLiveRuntimeMetadataByConversationID[
                                conversationID
                            ] = metadata
                        } else {
                            nativeLiveRuntimeMetadataByConversationID
                                .removeValue(forKey: conversationID)
                        }
                        return
                    }

                    if turn.canonicalStatus == "finalized_failure"
                        || turn.dispatchStatus == "rejected" {
                        throw NativeLiveSendError.failed(
                            code: turn.failureCode
                        )
                    }

                    throw LeileiAPIError.invalidResponse
                }
            } catch LeileiAPIError.missingAccessToken {
                throw LeileiAPIError.missingAccessToken
            } catch LeileiAPIError.unauthorized {
                throw LeileiAPIError.unauthorized
            } catch LeileiAPIError.forbidden {
                throw LeileiAPIError.forbidden
            } catch LeileiAPIError.invalidResponse {
                throw LeileiAPIError.invalidResponse
            } catch let error as LeileiAPIError {
                if case .backend(let status, _, _) = error,
                   status >= 500 {
                    // Preserve the same prepare id across transient server
                    // failures. Never create a duplicate send.
                    continue
                }
                throw error
            } catch let error as NativeLiveSendError {
                throw error
            } catch {
                // Network interruption: reconnect the same bounded wait.
                continue
            }
        }

        throw CancellationError()
    }
}
