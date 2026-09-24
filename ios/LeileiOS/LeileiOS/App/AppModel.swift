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

    private var nativeLiveCurrentPathETags: [UUID: String] = [:]
    private var conversationBootstrapInFlight = false
    private var chatRefreshInFlight = false
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
              let conversationID = activeNativeLiveConversationID,
              !chatRefreshInFlight else {
            return
        }

        chatRefreshInFlight = true
        if nativeLiveCurrentPath == nil {
            chatSyncState = .loading
        }
        defer {
            chatRefreshInFlight = false
        }

        do {
            let result = try await api.nativeLiveCurrentPath(
                conversationID: conversationID,
                etag: force ? nil : nativeLiveCurrentPathETags[conversationID]
            )

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
    }
}
