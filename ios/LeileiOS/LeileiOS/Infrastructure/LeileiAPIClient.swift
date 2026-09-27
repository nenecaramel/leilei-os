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

struct NativeLiveConversationPage: Sendable, Equatable {
    let conversations: [NativeLiveConversationSummary]
    let nextCursor: String?
}

struct NativeLiveCurrentPathSnapshot: Decodable, Sendable, Equatable {
    let conversationId: String
    let title: String?
    let currentHeadMessageId: String?
    let updatedAt: String
    let syncToken: String
    let truncated: Bool
    let olderCursor: String?
    let resetRequired: Bool
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
    let runtimeMetadata: NativeLiveRuntimeMetadata?
}

struct NativeLiveRuntimeMetadata: Decodable, Sendable, Equatable {
    let contextUsage: NativeLiveRuntimeContextUsage?
    let compactionAdvisory: NativeLiveRuntimeCompactionAdvisory?
    let compaction: NativeLiveRuntimeCompactionMetadata?
    let execution: NativeLiveRuntimeExecutionMetadata?

    enum CodingKeys: String, CodingKey {
        case contextUsage = "context_usage"
        case compactionAdvisory = "compaction_advisory"
        case compaction
        case execution
    }
}

struct NativeLiveRuntimeContextUsage: Decodable, Sendable, Equatable {
    let model: String?
    let totalTokens: Double?
    let maxTokens: Double?
    let rawMaxTokens: Double?
    let percentage: Double?

    enum CodingKeys: String, CodingKey {
        case model
        case totalTokens = "total_tokens"
        case maxTokens = "max_tokens"
        case rawMaxTokens = "raw_max_tokens"
        case percentage
    }
}

struct NativeLiveRuntimeCompactionAdvisory: Decodable, Sendable, Equatable {
    let due: Bool
    let thresholdPercent: Double
    let observedPercent: Double?
    let reason: String

    enum CodingKeys: String, CodingKey {
        case due
        case thresholdPercent = "threshold_percent"
        case observedPercent = "observed_percent"
        case reason
    }
}

struct NativeLiveRuntimeCompactionMetadata: Decodable, Sendable, Equatable {
    let source: String
    let attempted: Bool
    let outcome: String
    let summary: String?
    let failureCode: String?

    enum CodingKeys: String, CodingKey {
        case source
        case attempted
        case outcome
        case summary
        case failureCode = "failure_code"
    }
}

struct NativeLiveRuntimeExecutionMetadata: Decodable, Sendable, Equatable {
    let readback: NativeLiveRuntimeExecutionReadback
    let readbackError: String?

    enum CodingKeys: String, CodingKey {
        case readback
        case readbackError = "readback_error"
    }
}

struct NativeLiveRuntimeExecutionReadback: Decodable, Sendable, Equatable {
    let applied: NativeLiveRuntimeExecutionApplied
}

struct NativeLiveRuntimeExecutionApplied: Decodable, Sendable, Equatable {
    let model: String?
    let effort: String?
}

struct SystemConnectionsSnapshot: Decodable, Sendable, Equatable {
    let webAPI: String
    let publicMCP: String
    let internalMCP: String

    enum CodingKeys: String, CodingKey {
        case webAPI = "web_api"
        case publicMCP = "public_mcp"
        case internalMCP = "internal_mcp"
    }
}

struct SystemDataSummarySnapshot: Decodable, Sendable, Equatable {
    struct Diary: Decodable, Sendable, Equatable {
        let active: Int
        let archived: Int
    }

    struct Todo: Decodable, Sendable, Equatable {
        let active: Int
    }

    let diary: Diary
    let todo: Todo
}

struct SystemActivitySnapshot: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let occurredAt: String
    let label: String
    let source: String
    let outcome: String

    enum CodingKeys: String, CodingKey {
        case id
        case occurredAt = "occurred_at"
        case label
        case source
        case outcome
    }
}

struct ImportSummaryCountsSnapshot: Decodable, Sendable, Equatable {
    let create: Int
    let duplicate: Int
    let conflict: Int
    let invalid: Int
}

struct ImportSummarySnapshot: Decodable, Sendable, Equatable {
    let diary: ImportSummaryCountsSnapshot
    let todo: ImportSummaryCountsSnapshot
}

struct ImportPreviewSnapshot: Decodable, Sendable, Equatable {
    let previewFingerprint: String
    let summary: ImportSummarySnapshot
    let canExecute: Bool

    enum CodingKeys: String, CodingKey {
        case previewFingerprint = "preview_fingerprint"
        case summary
        case canExecute = "can_execute"
    }
}

struct ImportExecutionSnapshot: Decodable, Sendable, Equatable {
    let previewFingerprint: String

    enum CodingKeys: String, CodingKey {
        case previewFingerprint = "preview_fingerprint"
    }
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
        try await nativeLiveConversationPage(limit: limit).conversations
    }

    func nativeLiveConversationPage(
        limit: Int = 50,
        cursor: String? = nil
    ) async throws -> NativeLiveConversationPage {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path = "/api/v1/native-live/conversations"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let cursor {
            guard !cursor.isEmpty else {
                throw LeileiAPIError.invalidResponse
            }
            queryItems.append(
                URLQueryItem(name: "cursor", value: cursor)
            )
        }
        components.queryItems = queryItems
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveConversationListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return NativeLiveConversationPage(
            conversations: envelope.data.conversations,
            nextCursor: envelope.data.nextCursor
        )
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


    func nativeLiveRuntimeEvents(
        prepareID: String,
        afterSequence: Int,
        limit: Int = 100
    ) async throws -> NativeLiveRuntimeEventPage {
        guard afterSequence >= 0,
              (1...200).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeEventsEnvelope = try await request(
            path:
                "/api/v1/native-live/turns/\(prepareID)/events"
                + "?after_sequence=\(afterSequence)&limit=\(limit)",
            authenticated: true
        )

        return NativeLiveRuntimeEventPage(
            prepareID: envelope.data.prepareID,
            events: envelope.data.events,
            nextAfterSequence: envelope.data.nextAfterSequence
        )
    }

    func nativeLiveRuntimeInteractions(
        prepareID: String,
        limit: Int = 50
    ) async throws -> [NativeLiveRuntimeInteractionSnapshot] {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeInteractionsEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/interactions"
                    + "?limit=\(limit)",
                authenticated: true
            )
        return envelope.data.interactions
    }

    func nativeLiveRuntimeControls(
        prepareID: String,
        limit: Int = 50
    ) async throws -> [NativeLiveRuntimeControlSnapshot] {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: NativeLiveRuntimeControlsEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/controls"
                    + "?limit=\(limit)",
                authenticated: true
            )
        return envelope.data.controls
    }


    func resolveNativeLiveRuntimeInteraction(
        prepareID: String,
        interactionID: String,
        response: [String: NativeLiveJSONValue]
    ) async throws -> NativeLiveRuntimeInteractionSnapshot {
        let body = try JSONEncoder().encode(
            NativeLiveRuntimeInteractionResponseBody(
                response: response
            )
        )

        let envelope: NativeLiveRuntimeInteractionResolveEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)"
                    + "/interactions/\(interactionID)/respond",
                method: "POST",
                body: body,
                authenticated: true
            )
        return envelope.data.interaction
    }

    func nativeLiveCurrentPath(
        conversationID: UUID,
        limit: Int = 100,
        beforeMessageID: String? = nil,
        afterMessageID: String? = nil,
        etag: String? = nil
    ) async throws -> NativeLiveCurrentPathFetchResult {
        guard (1...200).contains(limit),
              beforeMessageID == nil || afterMessageID == nil else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path =
            "/api/v1/native-live/conversations/"
            + conversationID.uuidString.lowercased()
            + "/current-path"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let beforeMessageID {
            queryItems.append(
                URLQueryItem(
                    name: "before_message_id",
                    value: beforeMessageID
                )
            )
        }
        if let afterMessageID {
            queryItems.append(
                URLQueryItem(
                    name: "after_message_id",
                    value: afterMessageID
                )
            )
        }
        components.queryItems = queryItems
        guard let path = components.string,
              let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
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

    func systemConnections() async throws -> SystemConnectionsSnapshot {
        let envelope: SystemConnectionsEnvelope = try await request(
            path: "/api/v1/system/connections",
            authenticated: true
        )
        return envelope.data
    }

    func systemDataSummary() async throws -> SystemDataSummarySnapshot {
        let envelope: SystemDataSummaryEnvelope = try await request(
            path: "/api/v1/system/data",
            authenticated: true
        )
        return envelope.data
    }

    func systemActivity() async throws -> [SystemActivitySnapshot] {
        let envelope: SystemActivityEnvelope = try await request(
            path: "/api/v1/system/activity",
            authenticated: true
        )
        return envelope.data.events
    }

    func exportData(
        scope: String,
        includeAudit: Bool
    ) async throws -> Data {
        try await rawRequest(
            path: "/api/v1/system/export?scope=\(scope)&include_audit=\(includeAudit ? "true" : "false")"
        )
    }

    func previewImport(_ data: Data) async throws -> ImportPreviewSnapshot {
        let response = try await rawRequest(
            path: "/api/v1/system/import/preview",
            method: "POST",
            body: data,
            contentType: "application/octet-stream"
        )
        return try JSONDecoder().decode(
            ImportPreviewEnvelope.self,
            from: response
        ).data
    }

    func executeImport(
        _ data: Data,
        expectedPreviewFingerprint: String
    ) async throws -> ImportExecutionSnapshot {
        let response = try await rawRequest(
            path: "/api/v1/system/import/execute?expected_preview_fingerprint=\(expectedPreviewFingerprint)",
            method: "POST",
            body: data,
            contentType: "application/octet-stream"
        )
        return try JSONDecoder().decode(
            ImportExecutionEnvelope.self,
            from: response
        ).data
    }

    private func rawRequest(
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

private struct SystemConnectionsEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SystemConnectionsSnapshot
}

private struct SystemDataSummaryEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SystemDataSummarySnapshot
}

private struct SystemActivityEnvelope: Decodable, Sendable {
    struct ActivityData: Decodable, Sendable {
        let events: [SystemActivitySnapshot]
    }

    let success: Bool
    let data: ActivityData
}

private struct ImportPreviewEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ImportPreviewSnapshot
}

private struct ImportExecutionEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ImportExecutionSnapshot
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
        let nextCursor: String?
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

private struct NativeLiveTurnWaitEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WaitData

    struct WaitData: Decodable, Sendable {
        let outcome: String
        let turn: NativeLiveTurnSnapshot?
    }
}

private struct NativeLiveRuntimeInteractionResponseBody:
    Encodable,
    Sendable {
    let response: [String: NativeLiveJSONValue]
}

private struct NativeLiveRuntimeInteractionResolveEnvelope:
    Decodable,
    Sendable {
    struct ResolveData: Decodable, Sendable {
        let outcome: String
        let interaction: NativeLiveRuntimeInteractionSnapshot
    }

    let success: Bool
    let data: ResolveData
}

private struct NativeLiveRuntimeEventsEnvelope:
    Decodable,
    Sendable {
    struct EventData: Decodable, Sendable {
        let prepareID: String
        let events: [NativeLiveRuntimeEventSnapshot]
        let nextAfterSequence: Int

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case events
            case nextAfterSequence
        }
    }

    let success: Bool
    let data: EventData
}

private struct NativeLiveRuntimeInteractionsEnvelope:
    Decodable,
    Sendable {
    struct InteractionData: Decodable, Sendable {
        let prepareID: String
        let interactions: [NativeLiveRuntimeInteractionSnapshot]

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case interactions
        }
    }

    let success: Bool
    let data: InteractionData
}

private struct NativeLiveRuntimeControlsEnvelope:
    Decodable,
    Sendable {
    struct ControlData: Decodable, Sendable {
        let prepareID: String
        let controls: [NativeLiveRuntimeControlSnapshot]

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case controls
        }
    }

    let success: Bool
    let data: ControlData
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
