import Foundation
import Auth0

@MainActor
final class AuthSessionController {
    enum AuthSessionError: LocalizedError {
        case notConfigured
        case missingRefreshToken

        var errorDescription: String? {
            switch self {
            case .notConfigured:
                return "Auth0 native client is not configured."
            case .missingRefreshToken:
                return "Auth0 did not return a refresh token."
            }
        }
    }

    private let clientID: String?
    private let domain: String?
    private let audience: String?
    private let scope: String?
    private let credentialsManager: CredentialsManager?

    init(config: AppConfig) {
        self.clientID = config.authClientID
        self.domain = config.authIssuer?.host
        self.audience = config.authAudience
        self.scope = config.authScope

        if
            let clientID = config.authClientID,
            let domain = config.authIssuer?.host
        {
            self.credentialsManager = CredentialsManager(
                authentication: Auth0.authentication(
                    clientId: clientID,
                    domain: domain
                )
            )
        } else {
            self.credentialsManager = nil
        }
    }

    var canRenew: Bool {
        credentialsManager?.canRenew() ?? false
    }

    var hasSession: Bool {
        guard let credentialsManager else { return false }
        return credentialsManager.canRenew() || credentialsManager.hasValid()
    }

    func accessToken() async throws -> String? {
        guard let credentialsManager else {
            throw AuthSessionError.notConfigured
        }

        guard credentialsManager.canRenew() || credentialsManager.hasValid() else {
            return nil
        }

        let credentials = try await credentialsManager.credentials(minTTL: 60)
        return credentials.accessToken
    }

    func userProfile() -> UserProfile? {
        guard let credentialsManager else { return nil }

        do {
            return try credentialsManager.userProfile()
        } catch {
            return nil
        }
    }

    func signIn() async throws {
        guard
            let clientID,
            let domain,
            let audience,
            let scope,
            let credentialsManager
        else {
            throw AuthSessionError.notConfigured
        }

        let credentials = try await Auth0
            .webAuth(
                clientId: clientID,
                domain: domain
            )
            .useCredentialsManager(credentialsManager)
            .audience(audience)
            .scope("openid profile email offline_access \(scope)")
            .start()

        guard credentials.refreshToken != nil else {
            try? credentialsManager.clear()
            throw AuthSessionError.missingRefreshToken
        }
    }

    func reauthorize() async throws {
        guard
            let clientID,
            let domain,
            let audience,
            let scope,
            let credentialsManager
        else {
            throw AuthSessionError.notConfigured
        }

        try? credentialsManager.clear()

        let credentials = try await Auth0
            .webAuth(
                clientId: clientID,
                domain: domain
            )
            .useCredentialsManager(credentialsManager)
            .audience(audience)
            .scope("openid profile email offline_access \(scope)")
            .parameters(["prompt": "select_account"])
            .start()

        guard credentials.refreshToken != nil else {
            try? credentialsManager.clear()
            throw AuthSessionError.missingRefreshToken
        }
    }

    func signOut() async throws {
        guard
            let clientID,
            let domain,
            let credentialsManager
        else {
            throw AuthSessionError.notConfigured
        }

        do {
            try await Auth0
                .webAuth(
                    clientId: clientID,
                    domain: domain
                )
                .useCredentialsManager(credentialsManager)
                .logout()
        } catch {
            try? credentialsManager.clear()
            throw error
        }
    }
}
