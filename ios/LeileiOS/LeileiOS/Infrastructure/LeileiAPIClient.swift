import Foundation

struct BackendHealth: Sendable, Equatable {
    let service: String
    let status: String
}

struct BackendSession: Sendable, Equatable {
    let authenticated: Bool
}

struct NoContentResponse: Decodable, Sendable {}

struct NativeLiveConversationSummary: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let title: String?
    let currentHeadMessageId: String?
    let createdAt: String
    let updatedAt: String
}

struct NativeLiveCurrentPathSnapshot: Decodable, Sendable, Equatable {
    let conversationId: String
    let title: String?
    let currentHeadMessageId: String?
    let updatedAt: String
    let syncToken: String
    let truncated: Bool
    let messages: [NativeLiveCurrentPathMessage]
}

struct NativeLiveCurrentPathMessage: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let conversationId: String
    let parentMessageId: String?
    let role: String
    let status: String
    let createdAt: String
    let completedAt: String?
    let blocks: [NativeLiveCurrentPathBlock]

    var displayText: String {
        blocks
            .compactMap(\.text)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
}

struct NativeLiveCurrentPathBlock: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let ordinal: Int
    let kind: String
    let rawType: String
    let text: String?
    let createdAt: String
}

enum NativeLiveCurrentPathFetchResult: Sendable, Equatable {
    case modified(snapshot: NativeLiveCurrentPathSnapshot, etag: String?)
    case notModified
}

enum NativeLiveTurnWaitResult: Sendable, Equatable {
    case terminal(NativeLiveTurnSnapshot)
    case timeout
}

enum NativeLiveClaudeModel: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case opus55 = "claude-opus-5-5"
    case opus5 = "claude-opus-5"
    case sonnet5 = "claude-sonnet-5"
    case opus46 = "claude-opus-4-6"
    case sonnet46 = "claude-sonnet-4-6"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .opus55:
            return "Opus 5.5"
        case .opus5:
            return "Opus 5"
        case .sonnet5:
            return "Sonnet 5"
        case .opus46:
            return "Opus 4.6"
        case .sonnet46:
            return "Sonnet 4.6"
        }
    }

    var supportedThinkingModes: [NativeLiveThinkingMode] {
        switch self {
        case .opus55:
            return [.adaptive]
        case .opus5, .sonnet5, .opus46, .sonnet46:
            return [.adaptive, .disabled]
        }
    }

    func supportedEffortLevels(
        thinking: NativeLiveThinkingMode
    ) -> [NativeLiveEffortLevel] {
        switch self {
        case .opus55, .sonnet5:
            return [.low, .medium, .high, .xhigh, .max]
        case .opus5:
            return thinking == .disabled
                ? [.low, .medium, .high]
                : [.low, .medium, .high, .xhigh, .max]
        case .opus46, .sonnet46:
            return [.low, .medium, .high, .max]
        }
    }
}

enum NativeLiveThinkingMode: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case adaptive
    case disabled

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .adaptive:
            return "Adaptive"
        case .disabled:
            return "Off"
        }
    }
}

enum NativeLiveEffortLevel: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case low
    case medium
    case high
    case xhigh
    case max

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .low:
            return "Low"
        case .medium:
            return "Medium"
        case .high:
            return "High"
        case .xhigh:
            return "Extra High"
        case .max:
            return "Max"
        }
    }
}

struct NativeLiveExecutionSelection: Codable, Sendable, Equatable {
    let model: NativeLiveClaudeModel
    let thinking: NativeLiveThinkingMode
    let effort: NativeLiveEffortLevel
}

struct NativeLivePrepareResult: Decodable, Sendable, Equatable {
    let outcome: String
    let semanticPending: Bool
    let prepareId: String
    let requestId: String
    let conversationId: String
    let userMessageId: String
}

struct NativeLiveTurnSnapshot: Decodable, Sendable, Equatable {
    let prepareId: String
    let requestId: String
    let conversationId: String
    let operation: String
    let userMessageId: String
    let canonicalStatus: String
    let dispatchStatus: String
    let semanticStatus: String?
    let semanticFallbackCode: String?
    let failureCode: String?
}

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
    private let baseURL: URL
    private let session: URLSession
    private let authSession: AuthSessionController

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

    func nativeLiveConversations(
        limit: Int = 50
    ) async throws -> [NativeLiveConversationSummary] {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveConversationListEnvelope = try await request(
            path: "/api/v1/native-live/conversations?limit=\(limit)",
            authenticated: true
        )
        return envelope.data.conversations
    }

    func createNativeLiveConversation(
        title: String? = nil
    ) async throws -> NativeLiveConversationSummary {
        let body = try JSONEncoder().encode(
            CreateNativeLiveConversationBody(title: title)
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path: "/api/v1/native-live/conversations",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func renameNativeLiveConversation(
        conversationID: UUID,
        title: String
    ) async throws -> NativeLiveConversationSummary {
        let body = try JSONEncoder().encode(
            RenameNativeLiveConversationBody(title: title)
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func deleteNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())",
            method: "DELETE",
            authenticated: true
        )
    }

    func prepareNativeLiveSend(
        conversationID: UUID,
        expectedHeadMessageID: String?,
        text: String,
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveSendBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "send",
                conversationId: conversationID.uuidString.lowercased(),
                expectedHeadMessageId: expectedHeadMessageID,
                text: text,
                execution: execution
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func prepareNativeLiveRetry(
        conversationID: UUID,
        targetUserMessageID: String,
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveRetryBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "retry",
                conversationId: conversationID.uuidString.lowercased(),
                targetUserMessageId: targetUserMessageID,
                execution: execution
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func prepareNativeLiveEdit(
        conversationID: UUID,
        targetUserMessageID: String,
        text: String,
        execution: NativeLiveExecutionSelection? = nil,
        requestID: UUID = UUID()
    ) async throws -> NativeLivePrepareResult {
        let body = try JSONEncoder().encode(
            NativeLiveEditBody(
                dispatchTarget: "claude_code",
                requestId: requestID.uuidString.lowercased(),
                operation: "edit",
                conversationId: conversationID.uuidString.lowercased(),
                targetUserMessageId: targetUserMessageID,
                text: text,
                execution: execution
            )
        )
        let envelope: NativeLivePrepareEnvelope = try await request(
            path: "/api/v1/native-live/prepare",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveTurn(
        prepareID: String
    ) async throws -> NativeLiveTurnSnapshot {
        let envelope: NativeLiveTurnEnvelope = try await request(
            path: "/api/v1/native-live/turns/\(prepareID)",
            authenticated: true
        )
        return envelope.data
    }

    func waitNativeLiveTurn(
        prepareID: String
    ) async throws -> NativeLiveTurnWaitResult {
        let envelope: NativeLiveTurnWaitEnvelope = try await request(
            path: "/api/v1/native-live/turns/\(prepareID)/wait",
            method: "POST",
            authenticated: true
        )

        switch envelope.data.outcome {
        case "terminal":
            guard let turn = envelope.data.turn else {
                throw LeileiAPIError.invalidResponse
            }
            return .terminal(turn)
        case "timeout":
            guard envelope.data.turn == nil else {
                throw LeileiAPIError.invalidResponse
            }
            return .timeout
        default:
            throw LeileiAPIError.invalidResponse
        }
    }

    func nativeLiveCurrentPath(
        conversationID: UUID,
        limit: Int = 100,
        etag: String? = nil
    ) async throws -> NativeLiveCurrentPathFetchResult {
        guard (1...200).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let path = "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())/current-path?limit=\(limit)"
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        if let etag {
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
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
        case 304:
            return .notModified
        case 200:
            let envelope = try JSONDecoder().decode(
                NativeLiveCurrentPathEnvelope.self,
                from: data
            )
            return .modified(
                snapshot: envelope.data,
                etag: http.value(forHTTPHeaderField: "ETag")
            )
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

private struct NativeLiveConversationListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ConversationListData

    struct ConversationListData: Decodable, Sendable {
        let conversations: [NativeLiveConversationSummary]
    }
}

private struct NativeLiveConversationEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveConversationSummary
}

private struct CreateNativeLiveConversationBody: Encodable, Sendable {
    let title: String?
}

private struct RenameNativeLiveConversationBody: Encodable, Sendable {
    let title: String
}

private struct NativeLivePrepareEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLivePrepareResult
}

private struct NativeLiveTurnEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveTurnSnapshot
}

private struct NativeLiveTurnWaitEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WaitData

    struct WaitData: Decodable, Sendable {
        let outcome: String
        let turn: NativeLiveTurnSnapshot?
    }
}

private struct NativeLiveSendBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let expectedHeadMessageId: String?
    let text: String
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case expectedHeadMessageId = "expected_head_message_id"
        case text
        case execution
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dispatchTarget, forKey: .dispatchTarget)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(operation, forKey: .operation)
        try container.encode(conversationId, forKey: .conversationId)
        if let expectedHeadMessageId {
            try container.encode(
                expectedHeadMessageId,
                forKey: .expectedHeadMessageId
            )
        } else {
            try container.encodeNil(forKey: .expectedHeadMessageId)
        }
        try container.encode(text, forKey: .text)
        try container.encodeIfPresent(execution, forKey: .execution)
    }
}

private struct NativeLiveRetryBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let targetUserMessageId: String
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case targetUserMessageId = "target_user_message_id"
        case execution
    }
}

private struct NativeLiveEditBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let targetUserMessageId: String
    let text: String
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case targetUserMessageId = "target_user_message_id"
        case text
        case execution
    }
}

private struct NativeLiveCurrentPathEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveCurrentPathSnapshot
}

private struct SessionEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SessionData

    struct SessionData: Decodable, Sendable {
        let authenticated: Bool
    }
}

private struct ErrorEnvelope: Decodable, Sendable {
    let success: Bool
    let error: ErrorPayload

    struct ErrorPayload: Decodable, Sendable {
        let code: String?
        let message: String?
    }
}
