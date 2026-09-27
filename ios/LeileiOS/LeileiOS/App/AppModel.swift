import Foundation
import Combine
import Auth0

@MainActor
final class AppModel: ObservableObject {
    enum ChatSyncState: Equatable {
        case idle
        case loading
        case ready
        case unavailable(String)
    }

    enum ConversationBootstrapState: Equatable {
        case idle
        case loading
        case ready
        case unavailable(String)
    }

    enum ChatSendState: Equatable {
        case idle
        case sending
        case failed
    }

    enum ProbeState: Equatable {
        case idle
        case checking
        case reachable(String)
        case unavailable(String)

        var label: String {
            switch self {
            case .idle:
                return "Not checked"
            case .checking:
                return "Checking…"
            case .reachable(let status):
                return status
            case .unavailable(let message):
                return message
            }
        }
    }

    let config: AppConfig
    let authSession: AuthSessionController
    let api: LeileiAPIClient

    @Published private(set) var backendState: ProbeState = .idle
    @Published private(set) var sessionState: ProbeState = .idle
    @Published private(set) var isAuthenticated = false
    @Published private(set) var accountEmail: String?

    @Published private(set) var activeNativeLiveConversationID: UUID?
    @Published private(set) var nativeLiveConversations: [NativeLiveConversationSummary] = []
    @Published private(set) var nativeLiveConversationNextCursor: String?
    @Published private(set) var conversationBootstrapState: ConversationBootstrapState = .idle
    @Published private(set) var nativeLiveArchivedConversations: [NativeLiveConversationSummary] = []
    @Published private(set) var nativeLiveArchivedConversationNextCursor: String?
    @Published private(set) var archivedConversationBootstrapState: ConversationBootstrapState = .idle
    @Published private(set) var nativeLiveCurrentPath: NativeLiveCurrentPathSnapshot?
    @Published private(set) var chatSyncState: ChatSyncState = .idle
    @Published private(set) var chatSendState: ChatSendState = .idle
    @Published private(set) var nativeLiveRuntimeMetadata: NativeLiveRuntimeMetadata?
    @Published private(set) var nativeLiveRuntimeSurface:
        NativeLiveRuntimeSurfaceState?

    private var nativeLiveRuntimeMetadataByConversationID:
        [UUID: NativeLiveRuntimeMetadata] = [:]
    private var nativeLiveRuntimeObservationTask: Task<Void, Never>?
    private var conversationBootstrapInFlight = false
    private var conversationPaginationInFlight = false
    private var archivedConversationBootstrapInFlight = false
    private var archivedConversationPaginationInFlight = false
    private var chatRefreshInFlight = false
    private var chatOlderHistoryInFlight = false
    private var chatRefreshPendingForce = false
    private var chatSendInFlight = false
    private static let activeNativeLiveConversationDefaultsKey =
        "activeNativeLiveConversationID"

    init() {
        let config = AppConfig.production()
        let authSession = AuthSessionController(config: config)

        self.config = config
        self.authSession = authSession
        self.api = LeileiAPIClient(
            baseURL: config.apiBaseURL,
            authSession: authSession
        )

        let storedConversationID = UserDefaults.standard.string(
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
        let debugConversationID = ProcessInfo.processInfo.environment[
            "LEILEI_NATIVE_LIVE_CONVERSATION_ID"
        ]
        if let rawConversationID = storedConversationID ?? debugConversationID,
           let conversationID = UUID(uuidString: rawConversationID) {
            self.activeNativeLiveConversationID = conversationID
        }

        // Retire the old access-token-only Keychain entry.
        try? KeychainAccessTokenStore().clear()
    }

    func restoreAuthState() async {
        do {
            guard
                let token = try await authSession.accessToken(),
                !token.isEmpty
            else {
                isAuthenticated = false
                accountEmail = nil
                await refreshConnectivity()
                return
            }

            isAuthenticated = true
            accountEmail = authSession.userProfile()?.email

            #if DEBUG
            print("LeileiOS Auth0 renewable session:", authSession.canRenew)
            if let profile = authSession.userProfile() {
                print("LeileiOS Auth0 identity: sub=\(profile.sub) email=\(profile.email ?? "-")")
            } else {
                print("LeileiOS Auth0 identity: unavailable")
            }
            #endif
        } catch {
            isAuthenticated = false
            accountEmail = nil
        }

        await refreshConnectivity()
    }

    func signIn() async throws {
        try await authSession.signIn()

        isAuthenticated = true
        accountEmail = authSession.userProfile()?.email

        #if DEBUG
        if let profile = authSession.userProfile() {
            print("LeileiOS Auth0 identity after sign-in: sub=\(profile.sub) email=\(profile.email ?? "-")")
        }
        #endif

        await refreshConnectivity()
    }

    func reauthorize() async throws {
        try await authSession.reauthorize()

        isAuthenticated = true
        accountEmail = authSession.userProfile()?.email

        #if DEBUG
        if let profile = authSession.userProfile() {
            print("LeileiOS Auth0 identity after reauth: sub=\(profile.sub) email=\(profile.email ?? "-")")
        }
        #endif

        await refreshConnectivity()
    }

    func signOut() async throws {
        do {
            try await authSession.signOut()
        } catch {
            isAuthenticated = false
            accountEmail = nil
            sessionState = .unavailable("Sign-in required")
            throw error
        }

        isAuthenticated = false
        accountEmail = nil
        sessionState = .unavailable("Sign-in required")
        clearNativeLiveSessionData()
    }

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

    func sendNativeLiveMessage(
        _ text: String,
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
        guard !normalized.isEmpty, normalized.count <= 4_000 else {
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
                execution: execution
            )

            guard prepared.conversationId.caseInsensitiveCompare(
                conversationID.uuidString
            ) == .orderedSame else {
                throw LeileiAPIError.invalidResponse
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
        guard !normalized.isEmpty, normalized.count <= 4_000 else {
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

    func openNativeLiveConversation(_ conversationID: UUID) async {
        if activeNativeLiveConversationID != conversationID {
            activeNativeLiveConversationID = conversationID
            nativeLiveCurrentPath = nil
            nativeLiveRuntimeMetadata =
                nativeLiveRuntimeMetadataByConversationID[conversationID]
            chatSyncState = .idle
        }

        UserDefaults.standard.set(
            conversationID.uuidString.lowercased(),
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
        await refreshNativeLiveCurrentPath(force: true)
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

        while isAuthenticated,
              let conversationID = activeNativeLiveConversationID {
            chatRefreshInFlight = true
            let existingSnapshot = nativeLiveCurrentPath
            if existingSnapshot == nil {
                chatSyncState = .loading
            }

            do {
                let deltaAnchor = existingSnapshot?.currentHeadMessageId
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
                       deltaAnchor != nil,
                       !snapshot.resetRequired {
                        nativeLiveCurrentPath = mergeNativeLiveDelta(
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
                    messages: olderMessages + latest.messages
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
        defer {
            stopNativeLiveRuntimeObservation(
                prepareID: prepared.prepareId
            )
        }

        try await waitForNativeLiveTurn(
            prepareID: prepared.prepareId,
            conversationID: conversationID
        )
        await refreshNativeLiveCurrentPath(force: true)
    }

    private func beginNativeLiveRuntimeObservation(
        prepareID: String,
        conversationID: UUID
    ) {
        nativeLiveRuntimeObservationTask?.cancel()

        nativeLiveRuntimeSurface = NativeLiveRuntimeSurfaceState(
            prepareID: prepareID,
            conversationID: conversationID,
            events: [],
            interactions: [],
            controls: [],
            nextAfterSequence: 0
        )

        nativeLiveRuntimeObservationTask = Task { @MainActor [weak self] in
            guard let self else { return }

            var cycle = 0

            while !Task.isCancelled,
                  self.nativeLiveRuntimeSurface?.prepareID == prepareID {
                await self.refreshNativeLiveRuntimeSurface(
                    prepareID: prepareID,
                    conversationID: conversationID,
                    includeInteractions: cycle.isMultiple(of: 2)
                )
                cycle += 1

                try? await Task.sleep(
                    for: .milliseconds(500)
                )
            }
        }
    }

    private func stopNativeLiveRuntimeObservation(
        prepareID: String
    ) {
        guard nativeLiveRuntimeSurface?.prepareID == prepareID else {
            return
        }

        nativeLiveRuntimeObservationTask?.cancel()
        nativeLiveRuntimeObservationTask = nil
        nativeLiveRuntimeSurface = nil
    }

    private func refreshNativeLiveRuntimeSurface(
        prepareID: String,
        conversationID: UUID,
        includeInteractions: Bool
    ) async {
        guard var surface = nativeLiveRuntimeSurface,
              surface.prepareID == prepareID,
              surface.conversationID == conversationID else {
            return
        }

        do {
            let page = try await api.nativeLiveRuntimeEvents(
                prepareID: prepareID,
                afterSequence: surface.nextAfterSequence
            )
            guard page.prepareID == prepareID else {
                return
            }

            if !page.events.isEmpty {
                let known = Set(surface.events.map(\.sequence))
                surface.events.append(
                    contentsOf: page.events.filter {
                        !known.contains($0.sequence)
                    }
                )
            }
            surface.nextAfterSequence = page.nextAfterSequence
        } catch {
            // Runtime observation is fail-soft. Canonical turn completion
            // remains authoritative.
        }

        if includeInteractions {
            do {
                surface.interactions =
                    try await api.nativeLiveRuntimeInteractions(
                        prepareID: prepareID
                    )
            } catch {
                // Fail-soft; the next observation can recover.
            }

            do {
                surface.controls =
                    try await api.nativeLiveRuntimeControls(
                        prepareID: prepareID
                    )
            } catch {
                // Fail-soft; the next observation can recover.
            }
        }

        guard nativeLiveRuntimeSurface?.prepareID == prepareID else {
            return
        }
        nativeLiveRuntimeSurface = surface
    }

    func resolveNativeLiveRuntimeInteraction(
        _ interaction: NativeLiveRuntimeInteractionSnapshot,
        response: [String: NativeLiveJSONValue]
    ) async throws {
        guard let surface = nativeLiveRuntimeSurface,
              surface.prepareID == interaction.prepareID,
              surface.interactions.contains(where: {
                  $0.interactionID == interaction.interactionID
                      && $0.status == "pending"
              }) else {
            throw NativeLiveSendError.notReady
        }

        do {
            let updated =
                try await api.resolveNativeLiveRuntimeInteraction(
                    prepareID: interaction.prepareID,
                    interactionID: interaction.interactionID,
                    response: response
                )

            guard var latest = nativeLiveRuntimeSurface,
                  latest.prepareID == interaction.prepareID else {
                return
            }

            if let index = latest.interactions.firstIndex(where: {
                $0.interactionID == updated.interactionID
            }) {
                latest.interactions[index] = updated
            } else {
                latest.interactions.append(updated)
            }
            nativeLiveRuntimeSurface = latest
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

    func sendNativeLiveMidTurnInput(
        _ text: String
    ) async throws {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty,
              normalized.count <= 8_000 else {
            throw NativeLiveRuntimeControlClientError.invalidMidTurnInput
        }

        try await createNativeLiveRuntimeControl(
            kind: "mid_turn_input",
            payload: [
                "text": .string(normalized),
            ]
        )
    }

    func interruptNativeLiveTurn() async throws {
        try await createNativeLiveRuntimeControl(
            kind: "interrupt",
            payload: [:]
        )
    }

    private func createNativeLiveRuntimeControl(
        kind: String,
        payload: [String: NativeLiveJSONValue]
    ) async throws {
        guard var surface = nativeLiveRuntimeSurface else {
            throw NativeLiveRuntimeControlClientError.notReady
        }

        let controlID = UUID()

        do {
            let created =
                try await api.createNativeLiveRuntimeControl(
                    prepareID: surface.prepareID,
                    controlID: controlID,
                    kind: kind,
                    payload: payload
                )

            guard nativeLiveRuntimeSurface?.prepareID
                    == surface.prepareID else {
                return
            }

            if let index = surface.controls.firstIndex(where: {
                $0.controlID == created.controlID
            }) {
                surface.controls[index] = created
            } else {
                surface.controls.append(created)
            }
            nativeLiveRuntimeSurface = surface
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

    private func waitForNativeLiveTurn(
        prepareID: String,
        conversationID: UUID
    ) async throws {
        // Backend holds the completion wait. A timeout only renews the
        // bounded wait for the same durable prepare id; it does not poll.
        for _ in 0..<12 {
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

        await refreshNativeLiveCurrentPath(force: true)
        throw NativeLiveSendError.completionUnknown
    }

    private func mergeNativeLiveDelta(
        existing: NativeLiveCurrentPathSnapshot,
        delta: NativeLiveCurrentPathSnapshot
    ) -> NativeLiveCurrentPathSnapshot {
        let known = Set(existing.messages.map(\.id))
        let appended = delta.messages.filter {
            !known.contains($0.id)
        }
        return NativeLiveCurrentPathSnapshot(
            conversationId: delta.conversationId,
            title: delta.title,
            currentHeadMessageId: delta.currentHeadMessageId,
            updatedAt: delta.updatedAt,
            syncToken: delta.syncToken,
            truncated: existing.truncated,
            olderCursor: existing.olderCursor,
            resetRequired: false,
            messages: existing.messages + appended
        )
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
        let updated = NativeLiveConversationSummary(
            id: previous.id,
            title: snapshot.title,
            currentHeadMessageId: snapshot.currentHeadMessageId,
            createdAt: previous.createdAt,
            updatedAt: snapshot.updatedAt
        )
        nativeLiveConversations.remove(at: index)
        nativeLiveConversations.insert(updated, at: 0)
    }

    func refreshConnectivity() async {
        backendState = .checking
        sessionState = .checking

        do {
            let health = try await api.health()
            backendState = .reachable("\(health.service): \(health.status)")
        } catch {
            backendState = .unavailable(error.localizedDescription)
        }

        do {
            let session = try await api.authenticatedSession()
            isAuthenticated = session.authenticated

            if session.authenticated {
                accountEmail = accountEmail ?? authSession.userProfile()?.email
                sessionState = .reachable("Authenticated")
            } else {
                sessionState = .unavailable("Not authenticated")
            }
        } catch LeileiAPIError.missingAccessToken {
            isAuthenticated = false
            accountEmail = nil
            sessionState = .unavailable(
                config.isNativeAuthConfigured
                    ? "Sign-in required"
                    : "Auth0 native client not configured"
            )
        } catch LeileiAPIError.unauthorized {
            isAuthenticated = false
            accountEmail = nil
            sessionState = .unavailable("Sign-in required")
        } catch {
            sessionState = .unavailable(error.localizedDescription)
        }
    }

    private func clearActiveNativeLiveConversationIfMatching(
        _ conversationID: UUID
    ) {
        guard activeNativeLiveConversationID == conversationID else {
            return
        }

        activeNativeLiveConversationID = nil
        nativeLiveCurrentPath = nil
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

    private func clearNativeLiveSessionData() {
        nativeLiveConversations = []
        nativeLiveConversationNextCursor = nil
        conversationBootstrapState = .idle
        nativeLiveArchivedConversations = []
        nativeLiveArchivedConversationNextCursor = nil
        archivedConversationBootstrapState = .idle
        nativeLiveCurrentPath = nil
        nativeLiveRuntimeMetadata = nil
        nativeLiveRuntimeMetadataByConversationID.removeAll()
        nativeLiveRuntimeObservationTask?.cancel()
        nativeLiveRuntimeObservationTask = nil
        nativeLiveRuntimeSurface = nil
        chatSyncState = .idle
        conversationPaginationInFlight = false
        archivedConversationBootstrapInFlight = false
        archivedConversationPaginationInFlight = false
        chatRefreshInFlight = false
        chatOlderHistoryInFlight = false
        chatRefreshPendingForce = false
        chatSendState = .idle
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

private enum NativeLiveRuntimeControlClientError:
    LocalizedError {
    case notReady
    case invalidMidTurnInput

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "The current turn is not accepting input."
        case .invalidMidTurnInput:
            return "Mid-turn input must contain 1-8000 characters."
        }
    }
}

private enum NativeLiveSendError: LocalizedError {
    case notReady
    case invalidText
    case failed(code: String?)
    case completionUnknown

    var errorDescription: String? {
        switch self {
        case .notReady:
            return "Conversation is not ready."
        case .invalidText:
            return "Message must contain between 1 and 4000 characters."
        case .failed(let code):
            return code ?? "Failed"
        case .completionUnknown:
            return "Turn completion is unknown."
        }
    }
}
