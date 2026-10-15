import Foundation

extension AppModel {
    func refreshNativeLiveConversations() async {
        guard isAuthenticated,
              !conversationBootstrapInFlight else {
            return
        }

        conversationBootstrapInFlight = true
        if nativeLiveConversations.isEmpty {
            conversationBootstrapState = .loading
        }
        defer {
            conversationBootstrapInFlight = false
        }

        do {
            let page = try await api.nativeLiveConversationPage()
            nativeLiveConversations = page.conversations
            nativeLiveConversationNextCursor = page.nextCursor
            conversationBootstrapState = .ready
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            conversationBootstrapState = .unavailable(
                error.localizedDescription
            )
        }
    }

    func loadMoreNativeLiveConversations() async {
        guard isAuthenticated,
              !conversationBootstrapInFlight,
              !conversationPaginationInFlight,
              let cursor = nativeLiveConversationNextCursor else {
            return
        }

        conversationPaginationInFlight = true
        defer {
            conversationPaginationInFlight = false
        }

        do {
            let page = try await api.nativeLiveConversationPage(
                cursor: cursor
            )
            let existingIDs = Set(
                nativeLiveConversations.map { $0.id.lowercased() }
            )
            nativeLiveConversations.append(
                contentsOf: page.conversations.filter {
                    !existingIDs.contains($0.id.lowercased())
                }
            )
            nativeLiveConversationNextCursor = page.nextCursor
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            return
        }
    }

    func refreshNativeLiveArchivedConversations() async {
        guard isAuthenticated,
              !archivedConversationBootstrapInFlight else {
            return
        }

        archivedConversationBootstrapInFlight = true
        if nativeLiveArchivedConversations.isEmpty {
            archivedConversationBootstrapState = .loading
        }
        defer {
            archivedConversationBootstrapInFlight = false
        }

        do {
            let page = try await api.nativeLiveConversationPage(
                scope: .archived
            )
            nativeLiveArchivedConversations = page.conversations
            nativeLiveArchivedConversationNextCursor = page.nextCursor
            archivedConversationBootstrapState = .ready
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            archivedConversationBootstrapState = .unavailable(
                error.localizedDescription
            )
        }
    }

    func loadMoreNativeLiveArchivedConversations() async {
        guard isAuthenticated,
              !archivedConversationBootstrapInFlight,
              !archivedConversationPaginationInFlight,
              let cursor = nativeLiveArchivedConversationNextCursor else {
            return
        }

        archivedConversationPaginationInFlight = true
        defer {
            archivedConversationPaginationInFlight = false
        }

        do {
            let page = try await api.nativeLiveConversationPage(
                cursor: cursor,
                scope: .archived
            )
            let existingIDs = Set(
                nativeLiveArchivedConversations.map { $0.id.lowercased() }
            )
            nativeLiveArchivedConversations.append(
                contentsOf: page.conversations.filter {
                    !existingIDs.contains($0.id.lowercased())
                }
            )
            nativeLiveArchivedConversationNextCursor = page.nextCursor
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            return
        }
    }

    func archiveNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        guard isAuthenticated else {
            throw NativeLiveConversationLifecycleError.notReady
        }
        if activeNativeLiveConversationID == conversationID,
           chatSendInFlight {
            throw NativeLiveConversationLifecycleError.busy
        }

        do {
            try await api.archiveNativeLiveConversation(
                conversationID: conversationID
            )
            stopNativeLiveRuntimeObservations(
                conversationID: conversationID
            )

            nativeLiveConversations.removeAll {
                UUID(uuidString: $0.id) == conversationID
            }

            clearActiveNativeLiveConversationIfMatching(conversationID)

            await refreshNativeLiveConversations()
            await refreshNativeLiveArchivedConversations()
            await openFirstActiveNativeLiveConversationIfNeeded()
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }

    func restoreNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        guard isAuthenticated else {
            throw NativeLiveConversationLifecycleError.notReady
        }

        do {
            try await api.restoreNativeLiveConversation(
                conversationID: conversationID
            )

            nativeLiveArchivedConversations.removeAll {
                UUID(uuidString: $0.id) == conversationID
            }

            await refreshNativeLiveConversations()
            await refreshNativeLiveArchivedConversations()
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }

    func deleteNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        guard isAuthenticated else {
            throw NativeLiveConversationLifecycleError.notReady
        }
        if activeNativeLiveConversationID == conversationID,
           chatSendInFlight {
            throw NativeLiveConversationLifecycleError.busy
        }

        do {
            try await api.deleteNativeLiveConversation(
                conversationID: conversationID
            )
            stopNativeLiveRuntimeObservations(
                conversationID: conversationID
            )

            nativeLiveConversations.removeAll {
                UUID(uuidString: $0.id) == conversationID
            }
            nativeLiveArchivedConversations.removeAll {
                UUID(uuidString: $0.id) == conversationID
            }
            nativeLiveRuntimeMetadataByConversationID.removeValue(
                forKey: conversationID
            )

            clearActiveNativeLiveConversationIfMatching(conversationID)

            await refreshNativeLiveConversations()
            await refreshNativeLiveArchivedConversations()
            await openFirstActiveNativeLiveConversationIfNeeded()
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }

    @discardableResult

    func createNativeLiveConversation(
        title: String? = nil
    ) async throws -> UUID {
        conversationBootstrapState = .loading

        do {
            let conversation = try await api.createNativeLiveConversation(
                title: title
            )
            guard let conversationID = UUID(uuidString: conversation.id) else {
                throw LeileiAPIError.invalidResponse
            }

            nativeLiveConversations.removeAll {
                $0.id.caseInsensitiveCompare(conversation.id) == .orderedSame
            }
            nativeLiveConversations.insert(conversation, at: 0)
            conversationBootstrapState = .ready

            await openNativeLiveConversation(conversationID)
            return conversationID
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            conversationBootstrapState = .unavailable(
                error.localizedDescription
            )
            throw error
        }
    }

    @discardableResult

    func createNativeLiveConversationFromClaudeSession(
        requestID: String,
        sourceSessionID: String,
        title: String? = nil,
        historySnapshot: NativeLiveConversationHistoryUpload? = nil
    ) async throws -> UUID {
        conversationBootstrapState = .loading

        do {
            let conversation =
                try await api.createNativeLiveConversationFromClaudeSession(
                    requestID: requestID,
                    sourceSessionID: sourceSessionID,
                    title: title,
                    historySnapshot: historySnapshot
                )
            guard let conversationID =
                    UUID(uuidString: conversation.id) else {
                throw LeileiAPIError.invalidResponse
            }

            nativeLiveConversations.removeAll {
                $0.id.caseInsensitiveCompare(conversation.id)
                    == .orderedSame
            }
            nativeLiveConversations.insert(conversation, at: 0)
            conversationBootstrapState = .ready

            await openNativeLiveConversation(conversationID)
            return conversationID
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            conversationBootstrapState = .unavailable(
                error.localizedDescription
            )
            throw error
        }
    }

    func renameActiveNativeLiveConversation(
        _ title: String
    ) async throws {
        guard isAuthenticated,
              let conversationID = activeNativeLiveConversationID else {
            throw NativeLiveConversationLifecycleError.notReady
        }

        let normalized = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty, normalized.count <= 200 else {
            throw NativeLiveConversationLifecycleError.invalidTitle
        }

        do {
            let renamed = try await api.renameNativeLiveConversation(
                conversationID: conversationID,
                title: normalized
            )

            nativeLiveConversations.removeAll {
                $0.id.caseInsensitiveCompare(renamed.id) == .orderedSame
            }
            nativeLiveConversations.insert(renamed, at: 0)

            await refreshNativeLiveCurrentPath(force: true)
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
            throw LeileiAPIError.missingAccessToken
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
            throw LeileiAPIError.unauthorized
        } catch {
            throw error
        }
    }

    func deleteActiveNativeLiveConversation() async throws {
        guard let conversationID = activeNativeLiveConversationID else {
            throw NativeLiveConversationLifecycleError.notReady
        }
        try await deleteNativeLiveConversation(
            conversationID: conversationID
        )
    }

    func openNativeLiveConversation(_ conversationID: UUID) async {
        if activeNativeLiveConversationID != conversationID {
            activeNativeLiveConversationID = conversationID
            nativeLiveCurrentPath = nil
            nativeLiveHistorySnapshot = nil
            nativeLiveRuntimeMetadata =
                nativeLiveRuntimeMetadataByConversationID[conversationID]
            chatSyncState = .idle
        }

        UserDefaults.standard.set(
            conversationID.uuidString.lowercased(),
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
        // History comes only from LeileiOS canonical messages now.
        // Do not request the old 813-message Desktop display snapshot.
        nativeLiveHistorySnapshot = nil
        await refreshNativeLiveCurrentPath(force: true)
        await refreshActiveNativeLiveRuntimeMetadata()
        beginNativeLiveConversationHeadObservation(
            conversationID: conversationID
        )
    }

    func beginNativeLiveConversationHeadObservation(
        conversationID: UUID
    ) {
        nativeLiveConversationHeadObservationTask?.cancel()
        nativeLiveConversationHeadObservationTask =
            Task { @MainActor [weak self] in
                guard let self else { return }

                while !Task.isCancelled,
                      self.isAuthenticated,
                      self.activeNativeLiveConversationID
                        == conversationID {
                    let afterHeadMessageID =
                        self.nativeLiveCurrentPath?
                            .currentHeadMessageId

                    do {
                        let result =
                            try await self.api
                                .waitNativeLiveConversationHead(
                                    conversationID: conversationID,
                                    afterHeadMessageID:
                                        afterHeadMessageID
                                )

                        guard !Task.isCancelled,
                              self.activeNativeLiveConversationID
                                == conversationID else {
                            return
                        }

                        if result.outcome == "changed",
                           result.currentHeadMessageId
                                != afterHeadMessageID {
                            await self.refreshNativeLiveCurrentPath(
                                force: false,
                                surfaceTransientFailure: false
                            )
                            self.scheduleCurrentHeadMindWriteRefresh()
                        }
                    } catch is CancellationError {
                        return
                    } catch LeileiAPIError.missingAccessToken {
                        self.clearNativeLiveSessionData()
                        return
                    } catch LeileiAPIError.unauthorized {
                        self.clearNativeLiveSessionData()
                        return
                    } catch LeileiAPIError.backend(
                        let status,
                        _,
                        _
                    ) where status == 404 {
                        return
                    } catch {
                        try? await Task.sleep(
                            for: .seconds(1)
                        )
                    }
                }
            }
    }

    func stopNativeLiveConversationHeadObservation() {
        nativeLiveConversationHeadObservationTask?.cancel()
        nativeLiveConversationHeadObservationTask = nil
    }

    func refreshNativeLiveConversationHistorySnapshot() async {
        guard isAuthenticated,
              let conversationID = activeNativeLiveConversationID else {
            return
        }

        do {
            let snapshot =
                try await api.nativeLiveConversationHistorySnapshot(
                    conversationID: conversationID
                )
            guard activeNativeLiveConversationID == conversationID else {
                return
            }
            nativeLiveHistorySnapshot = snapshot
        } catch LeileiAPIError.backend(let status, _, _)
            where status == 404 {
            guard activeNativeLiveConversationID == conversationID else {
                return
            }
            nativeLiveHistorySnapshot = nil
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            // History snapshots are display-only and fail soft.
        }
    }

    func refreshNativeLiveCurrentPath(
        force: Bool = false,
        surfaceTransientFailure: Bool = true
    ) async {
        guard isAuthenticated,
              activeNativeLiveConversationID != nil else {
            return
        }

        if chatRefreshInFlight {
            if force {
                chatRefreshPendingForce = true
            }
            return
        }

        var requireForceRefresh = force

        while isAuthenticated,
              let conversationID = activeNativeLiveConversationID {
            chatRefreshInFlight = true
            let existingSnapshot = nativeLiveCurrentPath
            if existingSnapshot == nil {
                chatSyncState = .loading
            }

            do {
                let deltaAnchor =
                    requireForceRefresh
                        ? nil
                        : existingSnapshot?.currentHeadMessageId
                let result = try await api.nativeLiveCurrentPath(
                    conversationID: conversationID,
                    afterMessageID: deltaAnchor
                )

                guard activeNativeLiveConversationID == conversationID else {
                    chatRefreshInFlight = false
                    continue
                }

                switch result {
                case .notModified:
                    chatSyncState = .ready

                case .modified(let snapshot, _):
                    if let existingSnapshot,
                       requireForceRefresh,
                       !snapshot.resetRequired {
                        nativeLiveCurrentPath = NativeLiveCurrentPathTransforms.mergeNativeLiveRefresh(
                            existing: existingSnapshot,
                            refreshed: snapshot
                        )
                    } else if let existingSnapshot,
                              deltaAnchor != nil,
                              !snapshot.resetRequired {
                        nativeLiveCurrentPath = NativeLiveCurrentPathTransforms.mergeNativeLiveDelta(
                            existing: existingSnapshot,
                            delta: snapshot
                        )
                    } else {
                        nativeLiveCurrentPath = snapshot
                    }
                    reflectCurrentPathInConversationList()
                    chatSyncState = .ready
                }
            } catch LeileiAPIError.backend(let status, _, _) where status == 404 {
                nativeLiveCurrentPath = nil
                activeNativeLiveConversationID = nil
                UserDefaults.standard.removeObject(
                    forKey: Self.activeNativeLiveConversationDefaultsKey
                )
                chatSyncState = .unavailable("Conversation not found")
            } catch LeileiAPIError.missingAccessToken {
                clearNativeLiveSessionData()
            } catch LeileiAPIError.unauthorized {
                clearNativeLiveSessionData()
            } catch {
                if surfaceTransientFailure {
                    chatSyncState = .unavailable(
                        error.localizedDescription
                    )
                }
            }

            chatRefreshInFlight = false

            guard chatRefreshPendingForce,
                  isAuthenticated,
                  activeNativeLiveConversationID != nil else {
                chatRefreshPendingForce = false
                return
            }

            chatRefreshPendingForce = false
            requireForceRefresh = true
        }

        chatRefreshInFlight = false
        chatRefreshPendingForce = false
    }

    func loadOlderNativeLiveMessages() async {
        guard isAuthenticated,
              !chatRefreshInFlight,
              !chatOlderHistoryInFlight,
              let conversationID = activeNativeLiveConversationID,
              let current = nativeLiveCurrentPath,
              let olderCursor = current.olderCursor else {
            return
        }

        chatOlderHistoryInFlight = true
        let baseSyncToken = current.syncToken
        defer {
            chatOlderHistoryInFlight = false
        }

        do {
            let result = try await api.nativeLiveCurrentPath(
                conversationID: conversationID,
                beforeMessageID: olderCursor
            )

            guard activeNativeLiveConversationID == conversationID,
                  let latest = nativeLiveCurrentPath,
                  latest.syncToken == baseSyncToken else {
                return
            }

            switch result {
            case .notModified:
                return

            case .modified(let page, _):
                if page.resetRequired {
                    nativeLiveCurrentPath = page
                    reflectCurrentPathInConversationList()
                    chatSyncState = .ready
                    return
                }

                let known = Set(latest.messages.map(\.id))
                let olderMessages = page.messages.filter {
                    !known.contains($0.id)
                }
                nativeLiveCurrentPath = NativeLiveCurrentPathSnapshot(
                    conversationId: latest.conversationId,
                    title: latest.title,
                    currentHeadMessageId: latest.currentHeadMessageId,
                    updatedAt: latest.updatedAt,
                    syncToken: latest.syncToken,
                    truncated: page.truncated,
                    olderCursor: page.olderCursor,
                    resetRequired: false,
                    messages: olderMessages + latest.messages,
                    failedTurn: latest.failedTurn
                )
                chatSyncState = .ready
            }
        } catch LeileiAPIError.missingAccessToken {
            clearNativeLiveSessionData()
        } catch LeileiAPIError.unauthorized {
            clearNativeLiveSessionData()
        } catch {
            return
        }
    }

    private func reflectCurrentPathInConversationList() {
        guard let snapshot = nativeLiveCurrentPath,
              let index = nativeLiveConversations.firstIndex(where: {
                  $0.id.caseInsensitiveCompare(snapshot.conversationId)
                      == .orderedSame
              }) else {
            return
        }

        let previous = nativeLiveConversations[index]
        let currentHeadCreatedAt =
            snapshot.currentHeadMessageId.flatMap { headID in
                snapshot.messages.first(where: {
                    $0.id == headID
                })?.createdAt
            }

        let updated = NativeLiveConversationSummary(
            id: previous.id,
            title: snapshot.title,
            currentHeadMessageId: snapshot.currentHeadMessageId,
            lastMessageAt:
                currentHeadCreatedAt
                    ?? previous.lastMessageAt,
            createdAt: previous.createdAt,
            updatedAt: snapshot.updatedAt
        )
        nativeLiveConversations.remove(at: index)
        nativeLiveConversations.insert(updated, at: 0)
    }

    private func clearActiveNativeLiveConversationIfMatching(
        _ conversationID: UUID
    ) {
        guard activeNativeLiveConversationID == conversationID else {
            return
        }

        nativeLiveConversationHeadObservationTask?.cancel()
        nativeLiveConversationHeadObservationTask = nil
        activeNativeLiveConversationID = nil
        nativeLiveCurrentPath = nil
        nativeLiveHistorySnapshot = nil
        nativeLiveRuntimeMetadata = nil
        chatSyncState = .idle
        UserDefaults.standard.removeObject(
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
    }

    private func openFirstActiveNativeLiveConversationIfNeeded() async {
        guard activeNativeLiveConversationID == nil,
              let next = nativeLiveConversations.first,
              let nextID = UUID(uuidString: next.id) else {
            return
        }
        await openNativeLiveConversation(nextID)
    }
}

private enum NativeLiveConversationLifecycleError: LocalizedError {
    case notReady
    case invalidTitle
    case busy

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "No active conversation is available."
        case .invalidTitle:
            return "Conversation title must contain 1-200 characters."
        case .busy:
            return "Wait for the current turn to finish."
        }
    }
}
