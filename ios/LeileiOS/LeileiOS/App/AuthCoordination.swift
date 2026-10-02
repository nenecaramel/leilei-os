import Foundation
import Auth0

extension AppModel {
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
}
