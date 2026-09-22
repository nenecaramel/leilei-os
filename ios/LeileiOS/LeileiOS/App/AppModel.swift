import Foundation

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

    let config: AppConfig
    let tokenStore: KeychainAccessTokenStore
    let api: LeileiAPIClient

    @Published private(set) var backendState: ProbeState = .idle
    @Published private(set) var sessionState: ProbeState = .idle

    init(
        config: AppConfig = .production(),
        tokenStore: KeychainAccessTokenStore = KeychainAccessTokenStore()
    ) {
        self.config = config
        self.tokenStore = tokenStore
        self.api = LeileiAPIClient(
            baseURL: config.apiBaseURL,
            tokenStore: tokenStore
        )
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
            sessionState = session.authenticated
                ? .reachable("Authenticated")
                : .unavailable("Not authenticated")
        } catch LeileiAPIError.missingAccessToken {
            sessionState = .unavailable(
                config.isNativeAuthConfigured
                    ? "Sign-in required"
                    : "Auth0 native client not configured"
            )
        } catch {
            sessionState = .unavailable(error.localizedDescription)
        }
    }
}
