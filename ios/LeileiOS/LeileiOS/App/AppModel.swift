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
    @Published private(set) var conversationBootstrapState: ConversationBootstrapState = .idle
    @Published private(set) var nativeLiveCurrentPath: NativeLiveCurrentPathSnapshot?
    @Published private(set) var chatSyncState: ChatSyncState = .idle
    @Published private(set) var chatSendState: ChatSendState = .idle

    private var nativeLiveCurrentPathETags: [UUID: String] = [:]
    private var conversationBootstrapInFlight = false
    private var chatRefreshInFlight = false
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
            nativeLiveConversations = try await api.nativeLiveConversations()
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

            nativeLiveCurrentPathETags.removeValue(forKey: conversationID)
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
        guard isAuthenticated,
              let conversationID = activeNativeLiveConversationID else {
            throw NativeLiveConversationLifecycleError.notReady
        }
        guard !chatSendInFlight else {
            throw NativeLiveConversationLifecycleError.busy
        }

        do {
            try await api.deleteNativeLiveConversation(
                conversationID: conversationID
            )

            nativeLiveConversations.removeAll {
                guard let id = UUID(uuidString: $0.id) else {
                    return false
                }
                return id == conversationID
            }
            nativeLiveCurrentPathETags.removeValue(forKey: conversationID)

            if activeNativeLiveConversationID == conversationID {
                activeNativeLiveConversationID = nil
                nativeLiveCurrentPath = nil
                chatSyncState = .idle
                UserDefaults.standard.removeObject(
                    forKey: Self.activeNativeLiveConversationDefaultsKey
                )
            }

            await refreshNativeLiveConversations()

            if activeNativeLiveConversationID == nil,
               let next = nativeLiveConversations.first,
               let nextID = UUID(uuidString: next.id) {
                await openNativeLiveConversation(nextID)
            }
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

            try await waitForNativeLiveTurn(
                prepareID: prepared.prepareId,
                conversationID: conversationID
            )

            await refreshNativeLiveCurrentPath(force: true)
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
            chatSyncState = .idle
        }

        UserDefaults.standard.set(
            conversationID.uuidString.lowercased(),
            forKey: Self.activeNativeLiveConversationDefaultsKey
        )
        await refreshNativeLiveCurrentPath(force: true)
    }

    func refreshNativeLiveCurrentPath(force: Bool = false) async {
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

        var nextForce = force

        while isAuthenticated,
              let conversationID = activeNativeLiveConversationID {
            chatRefreshInFlight = true
            if nativeLiveCurrentPath == nil {
                chatSyncState = .loading
            }

            do {
                let result = try await api.nativeLiveCurrentPath(
                    conversationID: conversationID,
                    etag: nextForce
                        ? nil
                        : nativeLiveCurrentPathETags[conversationID]
                )

                guard activeNativeLiveConversationID == conversationID else {
                    chatRefreshInFlight = false
                    continue
                }

                switch result {
                case .notModified:
                    chatSyncState = .ready

                case .modified(let snapshot, let etag):
                    nativeLiveCurrentPath = snapshot
                    if let etag {
                        nativeLiveCurrentPathETags[conversationID] = etag
                    } else {
                        nativeLiveCurrentPathETags.removeValue(
                            forKey: conversationID
                        )
                    }
                    chatSyncState = .ready
                }
            } catch LeileiAPIError.backend(let status, _, _) where status == 404 {
                nativeLiveCurrentPath = nil
                nativeLiveCurrentPathETags.removeValue(forKey: conversationID)
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
                chatSyncState = .unavailable(error.localizedDescription)
            }

            chatRefreshInFlight = false

            guard chatRefreshPendingForce,
                  isAuthenticated,
                  activeNativeLiveConversationID != nil else {
                chatRefreshPendingForce = false
                return
            }

            chatRefreshPendingForce = false
            nextForce = true
        }

        chatRefreshInFlight = false
        chatRefreshPendingForce = false
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

        try await waitForNativeLiveTurn(
            prepareID: prepared.prepareId,
            conversationID: conversationID
        )
        await refreshNativeLiveCurrentPath(force: true)
        await refreshNativeLiveConversations()
    }

    private func waitForNativeLiveTurn(
        prepareID: String,
        conversationID: UUID
    ) async throws {
        // This is bounded foreground completion waiting for one user turn,
        // not background/runtime polling.
        for attempt in 0..<300 {
            try Task.checkCancellation()

            do {
                let turn = try await api.nativeLiveTurn(
                    prepareID: prepareID
                )

                guard turn.conversationId.caseInsensitiveCompare(
                    conversationID.uuidString
                ) == .orderedSame else {
                    throw LeileiAPIError.invalidResponse
                }

                if turn.canonicalStatus == "finalized_success" {
                    return
                }

                if turn.canonicalStatus == "finalized_failure"
                    || turn.dispatchStatus == "rejected" {
                    throw NativeLiveSendError.failed(
                        code: turn.failureCode
                    )
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
                    // A prepared turn may still be running while a
                    // foreground status read briefly fails. Keep waiting
                    // for the same prepare id instead of creating a
                    // duplicate send.
                } else {
                    throw error
                }
            } catch let error as NativeLiveSendError {
                throw error
            } catch {
                // Transport failure: preserve the same prepare id and retry
                // this foreground completion read.
            }

            if attempt < 299 {
                try await Task.sleep(for: .seconds(1))
            }
        }

        await refreshNativeLiveCurrentPath(force: true)
        throw NativeLiveSendError.completionUnknown
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

    private func clearNativeLiveSessionData() {
        nativeLiveConversations = []
        conversationBootstrapState = .idle
        nativeLiveCurrentPath = nil
        nativeLiveCurrentPathETags.removeAll()
        chatSyncState = .idle
        chatRefreshInFlight = false
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
            return "Wait for the current turn to finish before deleting this conversation."
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
