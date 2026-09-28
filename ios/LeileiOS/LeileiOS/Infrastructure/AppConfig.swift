import Foundation

struct AppConfig: Sendable {
    let apiBaseURL: URL
    let authIssuer: URL?
    let authAudience: String?
    let authScope: String?
    let authClientID: String?

    static func production(bundle: Bundle = .main) -> AppConfig {
        let info = bundle.infoDictionary ?? [:]

        let apiBaseURL = URL(
            string: (info["LEILEI_API_BASE_URL"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
                ?? "https://leilei-os-production.up.railway.app"
        )!

        return AppConfig(
            apiBaseURL: apiBaseURL,
            authIssuer: (info["LEILEI_AUTH0_ISSUER"] as? String)
                .flatMap { URL(string: $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
                ?? URL(string: "https://dev-qv68vnoepaps75ps.us.auth0.com/")!,
            authAudience: (info["LEILEI_AUTH0_AUDIENCE"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
                ?? "https://leilei-os-production.up.railway.app/api",
            authScope: (info["LEILEI_AUTH0_SCOPE"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
                ?? "leilei:web",
            authClientID: (info["LEILEI_AUTH0_CLIENT_ID"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
                ?? "5bl4SEMhSb90Np795gtTlj2YVccClsaY"
        )
    }

    var isNativeAuthConfigured: Bool {
        authIssuer != nil
            && authAudience != nil
            && authScope != nil
            && authClientID != nil
    }
}

private extension String {
    var nonEmpty: String? {
        isEmpty ? nil : self
    }
}
