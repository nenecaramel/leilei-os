import Foundation

struct BackendHealth: Sendable, Equatable {
    let service: String
    let status: String
}

struct BackendSession: Sendable, Equatable {
    let authenticated: Bool
}

struct NoContentResponse: Decodable, Sendable {}

enum LeileiAPIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case forbidden
    case backend(status: Int, code: String?, message: String?)
    case missingAccessToken

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The backend returned an invalid response."
        case .unauthorized:
            return "Authentication is required."
        case .forbidden:
            return "The current account is not allowed to access this resource."
        case .backend(let status, let code, let message):
            let label = code ?? "HTTP_\(status)"
            return message.map { "\(label): \($0)" } ?? label
        case .missingAccessToken:
            return "No Auth0 session is stored on this device."
        }
    }
}

@MainActor

final class LeileiAPIClient {
    let baseURL: URL
    let session: URLSession
    let authSession: AuthSessionController

    init(
        baseURL: URL,
        authSession: AuthSessionController,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.authSession = authSession
        self.session = session
    }

    func health() async throws -> BackendHealth {
        let envelope: HealthEnvelope = try await request(
            path: "/health",
            authenticated: false
        )
        return BackendHealth(
            service: envelope.data.service,
            status: envelope.data.status
        )
    }

    func authenticatedSession() async throws -> BackendSession {
        let envelope: SessionEnvelope = try await request(
            path: "/api/v1/session",
            authenticated: true
        )
        return BackendSession(authenticated: envelope.data.authenticated)
    }

    func rawRequest(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = nil
    ) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        guard
            let token = try await authSession.accessToken(),
            !token.isEmpty
        else {
            throw LeileiAPIError.missingAccessToken
        }
        request.setValue(
            "Bearer \(token)",
            forHTTPHeaderField: "Authorization"
        )

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw LeileiAPIError.invalidResponse
        }

        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw LeileiAPIError.unauthorized
        case 403:
            throw LeileiAPIError.forbidden
        default:
            let failure = try? JSONDecoder().decode(
                ErrorEnvelope.self,
                from: data
            )
            throw LeileiAPIError.backend(
                status: http.statusCode,
                code: failure?.error.code,
                message: failure?.error.message
            )
        }
    }

    func request<Response: Decodable>(
        path: String,
        method: String = "GET",
        body: Data? = nil,
        authenticated: Bool = true,
        idempotencyKey: String? = nil
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if let idempotencyKey {
            request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        }

        if authenticated {
            guard
                let token = try await authSession.accessToken(),
                !token.isEmpty
            else {
                throw LeileiAPIError.missingAccessToken
            }

            request.setValue(
                "Bearer \(token)",
                forHTTPHeaderField: "Authorization"
            )
        }

        let (data, response) = try await session.data(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw LeileiAPIError.invalidResponse
        }

        switch http.statusCode {
        case 200..<300:
            if http.statusCode == 204,
               let noContent = NoContentResponse() as? Response {
                return noContent
            }
            return try JSONDecoder().decode(Response.self, from: data)
        case 401:
            throw LeileiAPIError.unauthorized
        case 403:
            throw LeileiAPIError.forbidden
        default:
            let failure = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw LeileiAPIError.backend(
                status: http.statusCode,
                code: failure?.error.code,
                message: failure?.error.message
            )
        }
    }
}

private struct HealthEnvelope: Decodable, Sendable {
    let success: Bool
    let data: HealthData

    struct HealthData: Decodable, Sendable {
        let service: String
        let status: String
    }
}

private struct SessionEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SessionData

    struct SessionData: Decodable, Sendable {
        let authenticated: Bool
    }
}

struct ErrorEnvelope: Decodable, Sendable {
    let success: Bool
    let error: ErrorPayload

    struct ErrorPayload: Decodable, Sendable {
        let code: String?
        let message: String?
    }
}
