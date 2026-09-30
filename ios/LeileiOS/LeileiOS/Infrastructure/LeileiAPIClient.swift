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
    let lastMessageAt: String?
    let createdAt: String
    let updatedAt: String

    init(
        id: String,
        title: String?,
        currentHeadMessageId: String?,
        lastMessageAt: String? = nil,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.title = title
        self.currentHeadMessageId = currentHeadMessageId
        self.lastMessageAt = lastMessageAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct NativeLiveConversationPage: Sendable, Equatable {
    let conversations: [NativeLiveConversationSummary]
    let nextCursor: String?
}

enum NativeLiveConversationListScope: String, Sendable {
    case active
    case archived
}

enum MindProductKind: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case feel
    case memory
    case drive
    case thought
    case curiosity
    case topic

    var id: String { rawValue }

    var displayName: String {
        rawValue.capitalized
    }
}

struct MindProductLifecycleSnapshot: Decodable, Sendable, Equatable {
    let state: String?
    let role: String?
    let salience: Double?
    let pressure: Double?
    let strength: Double?
    let reinforcementCount: Double?
    let satisfactionTotal: Double?
    let protected: Bool?
    let lastRecalledAt: String?
    let resolvedAt: String?
    let dormantAt: String?
}

struct MindProductProvenanceSnapshot: Decodable, Sendable, Equatable {
    let sourceCount: Int
    let sourceKinds: [String]
}

struct MindProductItem: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let kind: MindProductKind
    let text: String?
    let source: String
    let authority: String?
    let occurredAt: String?
    let note: String?
    let lifecycle: MindProductLifecycleSnapshot
    let provenance: MindProductProvenanceSnapshot
    let createdAt: String
    let updatedAt: String
}

struct MindProductPage: Decodable, Sendable, Equatable {
    let items: [MindProductItem]
    let nextCursor: String?
}

struct MindProductMessageWriteProjection:
    Decodable,
    Sendable,
    Equatable {
    struct KindCount: Decodable, Sendable, Equatable, Identifiable {
        let kind: MindProductKind
        let count: Int

        var id: String { kind.rawValue }
    }

    let messageId: String
    let total: Int
    let kinds: [KindCount]
}

struct WorkspaceSummary: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    let description: String?
    let version: Int
    let createdAt: String
    let updatedAt: String
}

enum WorkspaceResourceKind: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case file
    case instructions
    case settings
    case skill
    case agent
    case mcp
    case hook
    case plugin

    var id: String { rawValue }
}

struct WorkspaceResourceSummary: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let workspaceId: String
    let kind: WorkspaceResourceKind
    let key: String
    let title: String?
    let metadata: [String: NativeLiveJSONValue]
    let version: Int
    let createdAt: String
    let updatedAt: String
}

struct WorkspaceResource: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let workspaceId: String
    let kind: WorkspaceResourceKind
    let key: String
    let title: String?
    let content: String?
    let metadata: [String: NativeLiveJSONValue]
    let version: Int
    let createdAt: String
    let updatedAt: String
}

struct WorkspaceConversationSummary: Decodable, Sendable, Equatable, Identifiable {
    let conversationId: String
    let title: String?
    let lifecycleStatus: String
    let currentHeadMessageId: String?
    let lastMessageAt: String?
    let addedAt: String

    var id: String { conversationId }
}

struct NativeLiveConversationRuntimeMetadataSnapshot:
    Decodable,
    Sendable,
    Equatable {
    let conversationId: String
    let currentHeadMessageId: String?
    let sourceMessageId: String?
    let workspaceId: String?
    let effectiveWorkspaceRoot: String?
    let runtimeMetadata: NativeLiveRuntimeMetadata?
    let observedAt: String?
}

enum NativeLiveManualCompactStatus: String, Decodable, Sendable, Equatable {
    case pending
    case reserved
    case completed
    case failed
    case stale
    case expired
}

struct NativeLiveManualCompactSnapshot: Decodable, Sendable, Equatable {
    let id: String
    let conversationId: String
    let status: NativeLiveManualCompactStatus
    let failureCode: String?
    let createdAt: String
    let completedAt: String?
}

enum NativeLiveExternalSessionRequestStatus:
    String,
    Decodable,
    Sendable,
    Equatable {
    case pending
    case reserved
    case completed
    case failed
    case expired
}

struct NativeLiveExternalClaudeSession:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    let sessionId: String
    let summary: String?
    let customTitle: String?
    let firstPrompt: String?
    let gitBranch: String?
    let lastModified: Double?
    let createdAt: Double?
    let workspaceId: String?
    let workspaceRoot: String

    var id: String { sessionId }
}

struct NativeLiveExternalSessionRequestSnapshot:
    Decodable,
    Sendable,
    Equatable {
    let id: String
    let status: NativeLiveExternalSessionRequestStatus
    let failureCode: String?
    let sessions: [NativeLiveExternalClaudeSession]
    let createdAt: String
    let completedAt: String?
}

struct NativeLiveConversationHistoryInputMessage:
    Codable,
    Sendable,
    Equatable {
    let role: String
    let time: String
    let content: String
}

struct NativeLiveConversationHistoryUpload:
    Encodable,
    Sendable,
    Equatable {
    let sourceLabel: String?
    let timeZone: String
    let messages: [NativeLiveConversationHistoryInputMessage]

    enum CodingKeys: String, CodingKey {
        case sourceLabel = "source_label"
        case timeZone = "time_zone"
        case messages
    }
}

struct NativeLiveConversationHistorySnapshot:
    Decodable,
    Sendable,
    Equatable {
    let conversationId: String
    let sourceProvider: String
    let sourceProviderSessionId: String
    let sourceLabel: String?
    let timeZone: String
    let messageCount: Int
    let firstMessageAt: String?
    let lastMessageAt: String?
    let createdAt: String
    let messages: [NativeLiveConversationHistoryMessage]
}

struct NativeLiveConversationHistoryMessage:
    Decodable,
    Sendable,
    Equatable,
    Identifiable {
    let ordinal: Int
    let role: String
    let time: String
    let content: String

    var id: Int { ordinal }
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
    let payload: [String: NativeLiveJSONValue]?
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
    let workspaceId: String?
    let expectedWorkspaceRoot: String?
}

struct NativeLiveTurnSnapshot: Decodable, Sendable, Equatable {
    let prepareId: String
    let requestId: String
    let conversationId: String
    let operation: String
    let userMessageId: String
    let workspaceId: String?
    let expectedWorkspaceRoot: String?
    let canonicalStatus: String
    let dispatchStatus: String
    let semanticStatus: String?
    let semanticFallbackCode: String?
    let failureCode: String?
    let runtimeMetadata: NativeLiveRuntimeMetadata?
}

struct NativeLiveRuntimeMetadata: Decodable, Sendable, Equatable {
    let contextUsage: NativeLiveRuntimeContextUsage?
    let execution: NativeLiveRuntimeExecutionMetadata?

    enum CodingKeys: String, CodingKey {
        case contextUsage = "context_usage"
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

    struct Count: Decodable, Sendable, Equatable {
        let count: Int
    }

    struct Conversations: Decodable, Sendable, Equatable {
        let active: Int
        let archived: Int
    }

    struct Universe: Decodable, Sendable, Equatable {
        let nodes: Int
    }

    let diary: Diary
    let diaryComments: Count
    let todo: Count
    let workspaces: Count
    let conversations: Conversations
    let mind: Count
    let universe: Universe

    enum CodingKeys: String, CodingKey {
        case diary
        case diaryComments = "diary_comments"
        case todo
        case workspaces
        case conversations
        case mind
        case universe
    }
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
    let diaryComments: ImportSummaryCountsSnapshot?
    let todo: ImportSummaryCountsSnapshot
    let workspaces: ImportSummaryCountsSnapshot?
    let mind: ImportSummaryCountsSnapshot?
    let conversations: ImportSummaryCountsSnapshot?
    let universe: ImportSummaryCountsSnapshot?

    enum CodingKeys: String, CodingKey {
        case diary
        case diaryComments = "diary_comments"
        case todo
        case workspaces
        case mind
        case conversations
        case universe
    }
}

struct ImportPreviewSnapshot: Decodable, Sendable, Equatable {
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let includedModules: [String]
    let auditIncluded: Bool
    let packageSHA256: String
    let previewFingerprint: String
    let summary: ImportSummarySnapshot
    let canExecute: Bool

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case exportedAt = "exported_at"
        case rawBytes = "raw_bytes"
        case includedModules = "included_modules"
        case auditIncluded = "audit_included"
        case packageSHA256 = "package_sha256"
        case previewFingerprint = "preview_fingerprint"
        case summary
        case canExecute = "can_execute"
    }
}

struct ImportExecutionSnapshot: Decodable, Sendable, Equatable {
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let includedModules: [String]
    let auditIncluded: Bool
    let packageSHA256: String
    let previewFingerprint: String
    let summary: ImportSummarySnapshot

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case exportedAt = "exported_at"
        case rawBytes = "raw_bytes"
        case includedModules = "included_modules"
        case auditIncluded = "audit_included"
        case packageSHA256 = "package_sha256"
        case previewFingerprint = "preview_fingerprint"
        case summary
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
        limit: Int = 50,
        scope: NativeLiveConversationListScope = .active
    ) async throws -> [NativeLiveConversationSummary] {
        try await nativeLiveConversationPage(
            limit: limit,
            scope: scope
        ).conversations
    }

    func nativeLiveConversationPage(
        limit: Int = 50,
        cursor: String? = nil,
        scope: NativeLiveConversationListScope = .active
    ) async throws -> NativeLiveConversationPage {
        guard (1...100).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path = "/api/v1/native-live/conversations"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "scope", value: scope.rawValue)
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

    func archiveNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())/archive",
            method: "POST",
            authenticated: true
        )
    }

    func restoreNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path: "/api/v1/native-live/conversations/\(conversationID.uuidString.lowercased())/restore",
            method: "POST",
            authenticated: true
        )
    }

    func deleteNativeLiveConversation(
        conversationID: UUID
    ) async throws {
        let _: NoContentResponse = try await request(
            path:
                "/api/v1/native-live/conversations/"
                + "\(conversationID.uuidString.lowercased())"
                + "?confirm=true",
            method: "DELETE",
            authenticated: true
        )
    }

    func createNativeLiveAttachmentUploadSlot(
        filename: String,
        mimeType: String,
        sizeBytes: Int,
        sha256: String,
        kind: NativeLiveComposerAttachmentKind
    ) async throws -> NativeLiveAttachmentUploadSlot {
        let body = try JSONEncoder().encode(
            NativeLiveAttachmentUploadSlotBody(
                filename: filename,
                mimeType: mimeType,
                sizeBytes: sizeBytes,
                sha256: sha256,
                kind: kind
            )
        )
        let envelope: NativeLiveAttachmentUploadSlotEnvelope =
            try await request(
                path: "/api/v1/native-live/attachments/upload-slots",
                method: "POST",
                body: body,
                authenticated: true
            )
        return envelope.data
    }

    func uploadNativeLiveAttachmentBytes(
        _ data: Data,
        to slot: NativeLiveAttachmentTransferSlot
    ) async throws {
        guard slot.method == "PUT",
              let url = URL(string: slot.url) else {
            throw LeileiAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        for (name, value) in slot.headers {
            request.setValue(value, forHTTPHeaderField: name)
        }

        let (_, response) = try await session.upload(
            for: request,
            from: data
        )
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw LeileiAPIError.invalidResponse
        }
    }

    func completeNativeLiveAttachment(
        attachmentID: String
    ) async throws -> NativeLiveChatAttachmentSnapshot {
        let envelope: NativeLiveAttachmentCompleteEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/attachments/"
                    + attachmentID
                    + "/complete",
                method: "POST",
                authenticated: true
            )
        return envelope.data.attachment
    }

    func nativeLiveAttachmentDownloadSlot(
        attachmentID: String
    ) async throws -> NativeLiveAttachmentDownloadSlot {
        let envelope: NativeLiveAttachmentDownloadSlotEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/attachments/"
                    + attachmentID
                    + "/download-slot",
                method: "POST",
                authenticated: true
            )
        return envelope.data
    }

    func prepareNativeLiveSend(
        conversationID: UUID,
        expectedHeadMessageID: String?,
        text: String,
        attachmentIDs: [String] = [],
        workspaceID: String? = nil,
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
                workspaceId: workspaceID,
                text: text,
                attachmentIds: attachmentIDs,
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
        attachmentIDs: [String]? = nil,
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
                attachmentIds: attachmentIDs,
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


    func createNativeLiveRuntimeControl(
        prepareID: String,
        controlID: UUID,
        kind: String,
        payload: [String: NativeLiveJSONValue]
    ) async throws -> NativeLiveRuntimeControlSnapshot {
        guard kind == "mid_turn_input"
                || kind == "interrupt" else {
            throw LeileiAPIError.invalidResponse
        }

        let body = try JSONEncoder().encode(
            NativeLiveRuntimeControlCreateBody(
                controlID:
                    controlID.uuidString.lowercased(),
                kind: kind,
                payload: payload
            )
        )

        let envelope: NativeLiveRuntimeControlCreateEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/turns/\(prepareID)/controls",
                method: "POST",
                body: body,
                authenticated: true
            )
        return envelope.data.control
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

    func nativeLiveConversationRuntimeMetadata(
        conversationID: UUID
    ) async throws -> NativeLiveConversationRuntimeMetadataSnapshot {
        let envelope: NativeLiveConversationRuntimeMetadataEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/conversations/"
                    + conversationID.uuidString.lowercased()
                    + "/runtime-metadata",
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveExternalSessionRequest()
        async throws -> NativeLiveExternalSessionRequestSnapshot {
        let envelope: NativeLiveExternalSessionRequestEnvelope =
            try await request(
                path: "/api/v1/native-live/external-sessions/requests",
                method: "POST",
                authenticated: true
            )
        return envelope.data
    }

    func nativeLiveExternalSessionRequest(
        requestID: String
    ) async throws -> NativeLiveExternalSessionRequestSnapshot {
        guard UUID(uuidString: requestID) != nil else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: NativeLiveExternalSessionRequestEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/external-sessions/requests/"
                    + requestID.lowercased(),
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveConversationFromClaudeSession(
        requestID: String,
        sourceSessionID: String,
        title: String? = nil,
        historySnapshot: NativeLiveConversationHistoryUpload? = nil
    ) async throws -> NativeLiveConversationSummary {
        guard UUID(uuidString: requestID) != nil,
              !sourceSessionID.trimmingCharacters(
                  in: .whitespacesAndNewlines
              ).isEmpty else {
            throw LeileiAPIError.invalidResponse
        }
        let body = try JSONEncoder().encode(
            CreateNativeLiveConversationFromClaudeSessionBody(
                requestID: requestID.lowercased(),
                sourceSessionID: sourceSessionID,
                title: title,
                historySnapshot: historySnapshot
            )
        )
        let envelope: NativeLiveConversationEnvelope = try await request(
            path:
                "/api/v1/native-live/conversations/from-claude-session",
            method: "POST",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveConversationHistorySnapshot(
        conversationID: UUID
    ) async throws -> NativeLiveConversationHistorySnapshot {
        let envelope: NativeLiveConversationHistoryEnvelope =
            try await request(
                path:
                    "/api/v1/native-live/conversations/"
                    + conversationID.uuidString.lowercased()
                    + "/history-snapshot",
                authenticated: true
            )
        return envelope.data
    }

    func createNativeLiveManualCompact(
        conversationID: UUID
    ) async throws -> NativeLiveManualCompactSnapshot {
        let envelope: NativeLiveManualCompactEnvelope = try await request(
            path:
                "/api/v1/native-live/conversations/"
                + conversationID.uuidString.lowercased()
                + "/compact",
            method: "POST",
            authenticated: true
        )
        return envelope.data
    }

    func nativeLiveManualCompact(
        requestID: String
    ) async throws -> NativeLiveManualCompactSnapshot {
        guard UUID(uuidString: requestID) != nil else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: NativeLiveManualCompactEnvelope = try await request(
            path:
                "/api/v1/native-live/manual-compacts/"
                + requestID.lowercased(),
            authenticated: true
        )
        return envelope.data
    }

    func mindPage(
        kind: MindProductKind? = nil,
        limit: Int = 100,
        cursor: String? = nil
    ) async throws -> MindProductPage {
        guard (1...200).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path = "/api/v1/mind"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let kind {
            queryItems.append(
                URLQueryItem(name: "kind", value: kind.rawValue)
            )
        }
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

        let envelope: MindProductPageEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func mindItem(
        stateID: String
    ) async throws -> MindProductItem {
        let envelope: MindProductItemEnvelope = try await request(
            path: "/api/v1/mind/\(stateID)",
            authenticated: true
        )
        return envelope.data
    }

    func createManualMind(
        kind: MindProductKind,
        text: String,
        occurredAt: Date? = nil,
        note: String? = nil,
        requestID: UUID
    ) async throws -> MindProductItem {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        let body = try JSONEncoder().encode(
            MindManualCreateBody(
                kind: kind,
                text: text,
                occurredAt: occurredAt.map(formatter.string(from:)),
                note: note
            )
        )
        let envelope: MindProductItemEnvelope = try await request(
            path: "/api/v1/mind",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func deleteMind(
        stateID: String
    ) async throws {
        let _: MindDeleteEnvelope = try await request(
            path: "/api/v1/mind/\(stateID)",
            method: "DELETE",
            authenticated: true
        )
    }

    func mindWrites(
        messageID: String
    ) async throws -> MindProductMessageWriteProjection {
        let envelope: MindProductMessageWriteEnvelope =
            try await request(
                path:
                    "/api/v1/mind/writes/messages/"
                    + messageID,
                authenticated: true
            )
        return envelope.data
    }

    func workspaces(
        conversationID: UUID? = nil
    ) async throws -> [WorkspaceSummary] {
        var components = URLComponents()
        components.path = "/api/v1/workspaces"
        if let conversationID {
            components.queryItems = [
                URLQueryItem(
                    name: "conversation_id",
                    value: conversationID.uuidString.lowercased()
                )
            ]
        }
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: WorkspaceListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func workspace(
        workspaceID: String
    ) async throws -> WorkspaceSummary {
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            authenticated: true
        )
        return envelope.data
    }

    func createWorkspace(
        name: String,
        description: String? = nil,
        requestID: UUID
    ) async throws -> WorkspaceSummary {
        let body = try JSONEncoder().encode(
            WorkspaceCreateBody(
                name: name,
                description: description
            )
        )
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func updateWorkspace(
        workspaceID: String,
        expectedVersion: Int,
        name: String,
        description: String?
    ) async throws -> WorkspaceSummary {
        let body = try JSONEncoder().encode(
            WorkspaceUpdateBody(
                expectedVersion: expectedVersion,
                name: name,
                description: description
            )
        )
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func deleteWorkspace(
        workspaceID: String,
        expectedVersion: Int
    ) async throws {
        let body = try JSONEncoder().encode(
            VersionMutationBody(expectedVersion: expectedVersion)
        )
        let _: NoContentResponse = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            method: "DELETE",
            body: body,
            authenticated: true
        )
    }

    func workspaceResources(
        workspaceID: String,
        kind: WorkspaceResourceKind? = nil
    ) async throws -> [WorkspaceResourceSummary] {
        var components = URLComponents()
        components.path = "/api/v1/workspaces/\(workspaceID)/resources"
        if let kind {
            components.queryItems = [
                URLQueryItem(name: "kind", value: kind.rawValue)
            ]
        }
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: WorkspaceResourceListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func workspaceResource(
        workspaceID: String,
        resourceID: String
    ) async throws -> WorkspaceResource {
        let envelope: WorkspaceResourceEnvelope = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            authenticated: true
        )
        return envelope.data
    }

    func createWorkspaceResource(
        workspaceID: String,
        kind: WorkspaceResourceKind,
        key: String,
        title: String?,
        content: String?,
        metadata: [String: NativeLiveJSONValue] = [:],
        requestID: UUID
    ) async throws -> WorkspaceResource {
        let body = try JSONEncoder().encode(
            WorkspaceResourceCreateBody(
                kind: kind,
                key: key,
                title: title,
                content: content,
                metadata: metadata
            )
        )
        let envelope: WorkspaceResourceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)/resources",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func updateWorkspaceResource(
        workspaceID: String,
        resourceID: String,
        expectedVersion: Int,
        title: String?,
        content: String?,
        metadata: [String: NativeLiveJSONValue]
    ) async throws -> WorkspaceResource {
        let body = try JSONEncoder().encode(
            WorkspaceResourceUpdateBody(
                expectedVersion: expectedVersion,
                title: title,
                content: content,
                metadata: metadata
            )
        )
        let envelope: WorkspaceResourceEnvelope = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func deleteWorkspaceResource(
        workspaceID: String,
        resourceID: String,
        expectedVersion: Int
    ) async throws {
        let body = try JSONEncoder().encode(
            VersionMutationBody(expectedVersion: expectedVersion)
        )
        let _: NoContentResponse = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            method: "DELETE",
            body: body,
            authenticated: true
        )
    }

    func workspaceConversations(
        workspaceID: String
    ) async throws -> [WorkspaceConversationSummary] {
        let envelope: WorkspaceConversationListEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)/conversations",
            authenticated: true
        )
        return envelope.data
    }

    func attachConversationToWorkspace(
        workspaceID: String,
        conversationID: UUID
    ) async throws -> Bool {
        let envelope: WorkspaceConversationMutationEnvelope =
            try await request(
                path:
                    "/api/v1/workspaces/\(workspaceID)"
                    + "/conversations/"
                    + conversationID.uuidString.lowercased(),
                method: "PUT",
                authenticated: true
            )
        return envelope.data.applied
    }

    func detachConversationFromWorkspace(
        workspaceID: String,
        conversationID: UUID
    ) async throws -> Bool {
        let envelope: WorkspaceConversationMutationEnvelope =
            try await request(
                path:
                    "/api/v1/workspaces/\(workspaceID)"
                    + "/conversations/"
                    + conversationID.uuidString.lowercased(),
                method: "DELETE",
                authenticated: true
            )
        return envelope.data.applied
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
        includeAudit: Bool
    ) async throws -> Data {
        try await rawRequest(
            path: "/api/v1/system/export?include_audit=\(includeAudit ? "true" : "false")"
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

private struct NativeLiveExternalSessionRequestEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveExternalSessionRequestSnapshot
}

private struct NativeLiveManualCompactEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveManualCompactSnapshot
}

private struct NativeLiveConversationRuntimeMetadataEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveConversationRuntimeMetadataSnapshot
}

private struct MindProductPageEnvelope: Decodable, Sendable {
    let success: Bool
    let data: MindProductPage
}

private struct MindProductItemEnvelope: Decodable, Sendable {
    let success: Bool
    let data: MindProductItem
}

private struct MindProductMessageWriteEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: MindProductMessageWriteProjection
}

private struct MindDeleteEnvelope: Decodable, Sendable {
    struct DeleteData: Decodable, Sendable {
        let deletedStateCount: Int
    }

    let success: Bool
    let data: DeleteData
}

private struct MindManualCreateBody: Encodable, Sendable {
    let kind: MindProductKind
    let text: String
    let occurredAt: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case kind
        case text
        case occurredAt = "occurred_at"
        case note
    }
}

private struct WorkspaceListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceSummary]
}

private struct WorkspaceEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WorkspaceSummary
}

private struct WorkspaceResourceListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceResourceSummary]
}

private struct WorkspaceResourceEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WorkspaceResource
}

private struct WorkspaceCreateBody: Encodable, Sendable {
    let name: String
    let description: String?
}

private struct WorkspaceUpdateBody: Encodable, Sendable {
    let expectedVersion: Int
    let name: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
        case name
        case description
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        try container.encode(name, forKey: .name)
        if let description {
            try container.encode(description, forKey: .description)
        } else {
            try container.encodeNil(forKey: .description)
        }
    }
}

private struct VersionMutationBody: Encodable, Sendable {
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
    }
}

private struct WorkspaceResourceCreateBody: Encodable, Sendable {
    let kind: WorkspaceResourceKind
    let key: String
    let title: String?
    let content: String?
    let metadata: [String: NativeLiveJSONValue]
}

private struct WorkspaceResourceUpdateBody: Encodable, Sendable {
    let expectedVersion: Int
    let title: String?
    let content: String?
    let metadata: [String: NativeLiveJSONValue]

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
        case title
        case content
        case metadata
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        if let title {
            try container.encode(title, forKey: .title)
        } else {
            try container.encodeNil(forKey: .title)
        }
        if let content {
            try container.encode(content, forKey: .content)
        } else {
            try container.encodeNil(forKey: .content)
        }
        try container.encode(metadata, forKey: .metadata)
    }
}

private struct WorkspaceConversationListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceConversationSummary]
}

private struct WorkspaceConversationMutationEnvelope: Decodable, Sendable {
    struct MutationData: Decodable, Sendable {
        let applied: Bool
    }

    let success: Bool
    let data: MutationData
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

private struct NativeLiveConversationHistoryEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveConversationHistorySnapshot
}

private struct CreateNativeLiveConversationFromClaudeSessionBody:
    Encodable,
    Sendable {
    let requestID: String
    let sourceSessionID: String
    let title: String?
    let historySnapshot: NativeLiveConversationHistoryUpload?

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case sourceSessionID = "source_session_id"
        case title
        case historySnapshot = "history_snapshot"
    }
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

private struct NativeLiveRuntimeControlCreateBody:
    Encodable,
    Sendable {
    let controlID: String
    let kind: String
    let payload: [String: NativeLiveJSONValue]

    enum CodingKeys: String, CodingKey {
        case controlID = "control_id"
        case kind
        case payload
    }
}

private struct NativeLiveRuntimeControlCreateEnvelope:
    Decodable,
    Sendable {
    struct ControlData: Decodable, Sendable {
        let outcome: String
        let control: NativeLiveRuntimeControlSnapshot
    }

    let success: Bool
    let data: ControlData
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

private struct NativeLiveAttachmentUploadSlotBody:
    Encodable,
    Sendable {
    let filename: String
    let mimeType: String
    let sizeBytes: Int
    let sha256: String
    let kind: NativeLiveComposerAttachmentKind

    enum CodingKeys: String, CodingKey {
        case filename
        case mimeType = "mime_type"
        case sizeBytes = "size_bytes"
        case sha256
        case kind
    }
}

private struct NativeLiveAttachmentUploadSlotEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveAttachmentUploadSlot
}

private struct NativeLiveAttachmentCompleteEnvelope:
    Decodable,
    Sendable {
    struct CompleteData: Decodable, Sendable {
        let attachment: NativeLiveChatAttachmentSnapshot
    }

    let success: Bool
    let data: CompleteData
}

private struct NativeLiveAttachmentDownloadSlotEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveAttachmentDownloadSlot
}

private struct NativeLiveSendBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let expectedHeadMessageId: String?
    let workspaceId: String?
    let text: String
    let attachmentIds: [String]
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case expectedHeadMessageId = "expected_head_message_id"
        case workspaceId = "workspace_id"
        case text
        case attachmentIds = "attachment_ids"
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
        try container.encodeIfPresent(workspaceId, forKey: .workspaceId)
        try container.encode(text, forKey: .text)
        if !attachmentIds.isEmpty {
            try container.encode(
                attachmentIds,
                forKey: .attachmentIds
            )
        }
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
    let attachmentIds: [String]?
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case targetUserMessageId = "target_user_message_id"
        case text
        case attachmentIds = "attachment_ids"
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
