import Foundation
import Combine
import Auth0

@MainActor
final class AppModel: ObservableObject {
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

    enum NativeAuthError: LocalizedError {
        case notConfigured

        var errorDescription: String? {
            "Auth0 native client is not configured."
        }
    }

    let config: AppConfig
    let tokenStore: KeychainAccessTokenStore
    let api: LeileiAPIClient

    @Published private(set) var backendState: ProbeState = .idle
    @Published private(set) var sessionState: ProbeState = .idle
    @Published private(set) var isAuthenticated = false
    @Published private(set) var accountEmail: String?

    init() {
        let config = AppConfig.production()
        let tokenStore = KeychainAccessTokenStore()

        self.config = config
        self.tokenStore = tokenStore
        self.api = LeileiAPIClient(
            baseURL: config.apiBaseURL,
            tokenStore: tokenStore
        )
    }

    init(
        config: AppConfig,
        tokenStore: KeychainAccessTokenStore
    ) {
        self.config = config
        self.tokenStore = tokenStore
        self.api = LeileiAPIClient(
            baseURL: config.apiBaseURL,
            tokenStore: tokenStore
        )
    }

    func restoreAuthState() async {
        guard
            let token = try? tokenStore.read(),
            !token.isEmpty
        else {
            isAuthenticated = false
            accountEmail = nil
            await refreshConnectivity()
            return
        }

        do {
            let session = try await api.authenticatedSession()
            isAuthenticated = session.authenticated

            if session.authenticated,
               let auth = try? authConfiguration() {
                let profile = try? await Auth0
                    .authentication(
                        clientId: auth.clientID,
                        domain: auth.domain
                    )
                    .userInfo(withAccessToken: token)
                    .start()

                accountEmail = profile?.email
            }
        } catch {
            isAuthenticated = false
            accountEmail = nil
        }

        await refreshConnectivity()
    }

    func signIn() async throws {
        let auth = try authConfiguration()

        let credentials = try await Auth0
            .webAuth(
                clientId: auth.clientID,
                domain: auth.domain
            )
            .audience(auth.audience)
            .scope("openid profile email \(auth.scope)")
            .start()

        try tokenStore.write(credentials.accessToken)

        isAuthenticated = true

        let profile = try? await Auth0
            .authentication(
                clientId: auth.clientID,
                domain: auth.domain
            )
            .userInfo(withAccessToken: credentials.accessToken)
            .start()

        accountEmail = profile?.email

        await refreshConnectivity()
    }

    func signOut() async throws {
        let auth = try authConfiguration()

        var logoutError: Error?

        do {
            try await Auth0
                .webAuth(
                    clientId: auth.clientID,
                    domain: auth.domain
                )
                .logout()
        } catch {
            logoutError = error
        }

        try tokenStore.clear()
        isAuthenticated = false
        accountEmail = nil
        sessionState = .unavailable("Sign-in required")

        if let logoutError {
            throw logoutError
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
            sessionState = session.authenticated
                ? .reachable("Authenticated")
                : .unavailable("Not authenticated")
        } catch LeileiAPIError.missingAccessToken {
            isAuthenticated = false
            sessionState = .unavailable(
                config.isNativeAuthConfigured
                    ? "Sign-in required"
                    : "Auth0 native client not configured"
            )
        } catch LeileiAPIError.unauthorized {
            isAuthenticated = false
            sessionState = .unavailable("Sign-in required")
        } catch {
            sessionState = .unavailable(error.localizedDescription)
        }
    }

    private func authConfiguration() throws -> (
        clientID: String,
        domain: String,
        audience: String,
        scope: String
    ) {
        guard
            let clientID = config.authClientID,
            let domain = config.authIssuer?.host,
            let audience = config.authAudience,
            let scope = config.authScope
        else {
            throw NativeAuthError.notConfigured
        }

        return (clientID, domain, audience, scope)
    }
}
