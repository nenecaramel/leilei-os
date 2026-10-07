import Foundation

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

struct NativeLiveConversationRuntimeMetadataSnapshot:
    Decodable,
    Sendable,
    Equatable {
    let conversationId: String
    let currentHeadMessageId: String?
    let sourceMessageId: String?
    let effectiveWorkingDirectory: String?
    let runtimeMetadata: NativeLiveRuntimeMetadata?
    let observedAt: String?
}

enum NativeLiveClaudeHandoffStatus:
    String,
    Decodable,
    Sendable,
    Equatable {
    case pending
    case reserved
    case completed
    case failed
    case stale
    case expired
}

struct NativeLiveClaudeHandoffSnapshot:
    Decodable,
    Sendable,
    Equatable {
    let id: String
    let conversationId: String
    let status: NativeLiveClaudeHandoffStatus
    let handoffSessionId: String?
    let effectiveWorkingDirectory: String?
    let failureCode: String?
    let createdAt: String
    let completedAt: String?
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
    let workingDirectory: String

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

struct NativeLiveConversationHeadWaitSnapshot:
    Decodable,
    Sendable,
    Equatable {
    let outcome: String
    let currentHeadMessageId: String?
}

struct NativeLiveConversationHeadWaitEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveConversationHeadWaitSnapshot
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
    var failedTurn: NativeLiveFailedTurnSnapshot? = nil
}

struct NativeLiveMessageActivitySnapshot:
    Decodable,
    Sendable,
    Equatable {
    let prepareId: String?
    let events: [NativeLiveRuntimeEventSnapshot]
    let interactions: [NativeLiveRuntimeInteractionSnapshot]
    let durationMs: Double?
    let startedAt: String?

    init(
        prepareId: String?,
        events: [NativeLiveRuntimeEventSnapshot],
        interactions: [NativeLiveRuntimeInteractionSnapshot],
        durationMs: Double? = nil,
        startedAt: String? = nil
    ) {
        self.prepareId = prepareId
        self.events = events
        self.interactions = interactions
        self.durationMs = durationMs
        self.startedAt = startedAt
    }
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
    let activity: NativeLiveMessageActivitySnapshot?

    init(
        id: String,
        conversationId: String,
        parentMessageId: String?,
        role: String,
        status: String,
        createdAt: String,
        completedAt: String?,
        blocks: [NativeLiveCurrentPathBlock],
        activity: NativeLiveMessageActivitySnapshot? = nil
    ) {
        self.id = id
        self.conversationId = conversationId
        self.parentMessageId = parentMessageId
        self.role = role
        self.status = status
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.blocks = blocks
        self.activity = activity
    }

    var displayText: String {
        blocks
            .filter { $0.kind == "text" }
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
    case sonnet55 = "claude-sonnet-5-5"
    case opus5 = "claude-opus-5"
    case sonnet5 = "claude-sonnet-5"
    case opus46 = "claude-opus-4-6"
    case sonnet46 = "claude-sonnet-4-6"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .opus55:
            return "Opus 5.5"
        case .sonnet55:
            return "Sonnet 5.5"
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
        case .sonnet55:
            return [.adaptive, .betweenTools]
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
        case .sonnet55:
            return thinking == .betweenTools
                ? [.low, .medium, .high]
                : [.low, .medium, .high, .xhigh, .max]
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
    case betweenTools = "between_tools"
    case disabled

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .adaptive:
            return "Adaptive"
        case .betweenTools:
            return "Between tools"
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
    var preparedUserMessage: NativeLiveCurrentPathMessage? = nil
    var replacementTargetUserMessageId: String? = nil
    var startedAt: String? = nil
    let outcome: String
    let semanticPending: Bool
    let prepareId: String
    let requestId: String
    let conversationId: String
    let userMessageId: String
    let expectedWorkingDirectory: String?
}

struct NativeLiveTurnSnapshot: Decodable, Sendable, Equatable {
    var preparedUserMessage: NativeLiveCurrentPathMessage? = nil
    var replacementTargetUserMessageId: String? = nil
    var startedAt: String? = nil
    let prepareId: String
    let requestId: String
    let conversationId: String
    let operation: String
    let userMessageId: String
    let expectedWorkingDirectory: String?
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
    let environment: NativeLiveRuntimeEnvironment?
    let result: NativeLiveRuntimeResultTelemetry?
    let outputResources: [NativeLiveRuntimeOutputResource]?
    let vcsChanges: [NativeLiveRuntimeVcsChange]?
    let sessionStore: NativeLiveRuntimeSessionStoreHealth?

    enum CodingKeys: String, CodingKey {
        case contextUsage = "context_usage"
        case execution
        case environment
        case result
        case outputResources = "output_resources"
        case vcsChanges = "vcs_changes"
        case sessionStore = "session_store"
    }
}

struct NativeLiveRuntimeVcsChange:
    Decodable,
    Sendable,
    Equatable {
    let mutationKind: String
    let cwd: String
    let branch: String?

    enum CodingKeys: String, CodingKey {
        case mutationKind = "mutation_kind"
        case cwd
        case branch
    }
}

struct NativeLiveRuntimeSessionStoreHealth:
    Decodable,
    Sendable,
    Equatable {
    let provider: String
    let configured: Bool
    let mode: String
    let sessionId: String?
    let parentSessionId: String?
    let projectKey: String
    let cwd: String
    let parentLocalAvailable: Bool?
    let parentStatusBefore: String?
    let backfillStatus: String
    let backfillFailureReason: String?
    let mirrorStatus: String
    let mirrorFailureReason: String?
    let statusAfter: String?
    let statusFailureReason: String?

    enum CodingKeys: String, CodingKey {
        case provider
        case configured
        case mode
        case sessionId = "session_id"
        case parentSessionId = "parent_session_id"
        case projectKey = "project_key"
        case cwd
        case parentLocalAvailable = "parent_local_available"
        case parentStatusBefore = "parent_status_before"
        case backfillStatus = "backfill_status"
        case backfillFailureReason = "backfill_failure_reason"
        case mirrorStatus = "mirror_status"
        case mirrorFailureReason = "mirror_failure_reason"
        case statusAfter = "status_after"
        case statusFailureReason = "status_failure_reason"
    }
}

struct NativeLiveRuntimeOutputResource:
    Decodable,
    Sendable,
    Equatable {
    let source: String
    let toolUseId: String?
    let taskId: String?
    let uri: String
    let name: String?
    let title: String?
    let description: String?
    let mimeType: String?
    let size: Double?
    let annotations: [String: NativeLiveJSONValue]?
    let metadata: [String: NativeLiveJSONValue]?

    enum CodingKeys: String, CodingKey {
        case source
        case toolUseId = "tool_use_id"
        case taskId = "task_id"
        case uri
        case name
        case title
        case description
        case mimeType = "mime_type"
        case size
        case annotations
        case metadata
    }
}

struct NativeLiveRuntimeResultTelemetry:
    Decodable,
    Sendable,
    Equatable {
    let subtype: String?
    let isError: Bool?
    let durationMs: Double?
    let durationApiMs: Double?
    let numTurns: Double?
    let queuedTurnCount: Double?
    let stopReason: String?
    let terminalReason: String?
    let apiErrorStatus: Double?
    let startupFailureReason: String?
    let fastModeState: String?
    let fastModeDisabledReason: String?
    let totalCostUsd: Double?
    let origin: [String: NativeLiveJSONValue]?
    let usage: [String: NativeLiveJSONValue]?
    let modelUsage: [String: NativeLiveJSONValue]?
    let permissionDenials:
        [NativeLiveRuntimeResultPermissionDenial]
    let errors: [String]
    let structuredOutputPresent: Bool
    let deferredToolUsePresent: Bool
    let latency: NativeLiveRuntimeResultLatency

    enum CodingKeys: String, CodingKey {
        case subtype
        case isError = "is_error"
        case durationMs = "duration_ms"
        case durationApiMs = "duration_api_ms"
        case numTurns = "num_turns"
        case queuedTurnCount = "queued_turn_count"
        case stopReason = "stop_reason"
        case terminalReason = "terminal_reason"
        case apiErrorStatus = "api_error_status"
        case startupFailureReason = "startup_failure_reason"
        case fastModeState = "fast_mode_state"
        case fastModeDisabledReason = "fast_mode_disabled_reason"
        case totalCostUsd = "total_cost_usd"
        case origin
        case usage
        case modelUsage
        case permissionDenials = "permission_denials"
        case errors
        case structuredOutputPresent =
            "structured_output_present"
        case deferredToolUsePresent =
            "deferred_tool_use_present"
        case latency
    }
}

struct NativeLiveRuntimeResultPermissionDenial:
    Decodable,
    Sendable,
    Equatable {
    let toolName: String?
    let toolUseId: String?
    let toolInput: [String: NativeLiveJSONValue]?

    enum CodingKeys: String, CodingKey {
        case toolName = "tool_name"
        case toolUseId = "tool_use_id"
        case toolInput = "tool_input"
    }
}

struct NativeLiveRuntimeResultLatency:
    Decodable,
    Sendable,
    Equatable {
    let ttftMs: Double?
    let ttftStreamMs: Double?
    let timeToRequestMs: Double?
    let timeToRequestFromSpawnMs: Double?
    let timeOriginMs: Double?
    let warmSpareClaimed: Bool?
    let firstContentFrameMs: Double?
    let firstStreamPostMs: Double?
    let firstStreamPostAckMs: Double?
    let firstStreamPostWallMs: Double?
    let firstTextPostMs: Double?
    let firstTextPostWallMs: Double?
    let firstStreamPostQueueWaitMs: Double?
    let firstStreamPostQueuedBehind: Double?

    enum CodingKeys: String, CodingKey {
        case ttftMs = "ttft_ms"
        case ttftStreamMs = "ttft_stream_ms"
        case timeToRequestMs = "time_to_request_ms"
        case timeToRequestFromSpawnMs =
            "time_to_request_from_spawn_ms"
        case timeOriginMs = "time_origin_ms"
        case warmSpareClaimed = "warm_spare_claimed"
        case firstContentFrameMs = "first_content_frame_ms"
        case firstStreamPostMs = "first_stream_post_ms"
        case firstStreamPostAckMs = "first_stream_post_ack_ms"
        case firstStreamPostWallMs =
            "first_stream_post_wall_ms"
        case firstTextPostMs = "first_text_post_ms"
        case firstTextPostWallMs = "first_text_post_wall_ms"
        case firstStreamPostQueueWaitMs =
            "first_stream_post_queue_wait_ms"
        case firstStreamPostQueuedBehind =
            "first_stream_post_queued_behind"
    }
}

struct NativeLiveRuntimeEnvironment: Decodable, Sendable, Equatable {
    let model: String?
    let cwd: String?
    let tools: [String]
    let mcpServers: [NativeLiveRuntimeEnvironmentNamedStatus]
    let permissionMode: String?
    let slashCommands: [String]
    let terminalSlashCommands: [String]
    let apiKeySource: String?
    let outputStyle: String?
    let agents: [String]
    let betas: [String]
    let claudeCodeVersion: String?
    let sdkVersion: String?
    let skills: [String]
    let plugins: [NativeLiveRuntimeEnvironmentPlugin]
    let pluginErrors: [NativeLiveRuntimeEnvironmentPluginError]
    let effort: String?
    let capabilities: [String]
    let fastMode: NativeLiveRuntimeEnvironmentFastMode?

    enum CodingKeys: String, CodingKey {
        case model
        case cwd
        case tools
        case mcpServers = "mcp_servers"
        case permissionMode = "permission_mode"
        case slashCommands = "slash_commands"
        case terminalSlashCommands = "terminal_slash_commands"
        case apiKeySource = "api_key_source"
        case outputStyle = "output_style"
        case agents
        case betas
        case claudeCodeVersion = "claude_code_version"
        case sdkVersion = "sdk_version"
        case skills
        case plugins
        case pluginErrors = "plugin_errors"
        case effort
        case capabilities
        case fastMode = "fast_mode"
    }
}

struct NativeLiveRuntimeEnvironmentNamedStatus:
    Decodable,
    Sendable,
    Equatable {
    let name: String?
    let status: String?
    let source: String?
}

struct NativeLiveRuntimeEnvironmentPlugin:
    Decodable,
    Sendable,
    Equatable {
    let name: String?
    let path: String?
}

struct NativeLiveRuntimeEnvironmentPluginError:
    Decodable,
    Sendable,
    Equatable {
    let plugin: String?
    let type: String?
    let message: String?
    let path: String?
}

struct NativeLiveRuntimeEnvironmentFastMode:
    Decodable,
    Sendable,
    Equatable {
    let state: String?
    let disabledReason: String?

    enum CodingKeys: String, CodingKey {
        case state
        case disabledReason = "disabled_reason"
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

// Backend-owned evidence survives preparation/event retention without forging a Chat identity.
struct NativeLiveFailedTurnSnapshot: Decodable, Sendable, Equatable {
    let prepareId: String
    let requestId: String
    let conversationId: String
    let operation: String
    let userMessageId: String
    let preparedUserMessage: NativeLiveCurrentPathMessage
    let replacementTargetUserMessageId: String?
    let anchorHeadMessageId: String?
    let startedAt: String
    let failureCode: String
    let events: [NativeLiveRuntimeEventSnapshot]
    let interactions: [NativeLiveRuntimeInteractionSnapshot]

    var runtimeSurface: NativeLiveRuntimeSurfaceState? {
        guard let conversation = UUID(uuidString:conversationId),
              preparedUserMessage.id == userMessageId,
              preparedUserMessage.conversationId == conversationId,
              preparedUserMessage.role == "user" else { return nil }
        return .init(prepareID:prepareId,conversationID:conversation,events:events,interactions:interactions,controls:[],
            nextAfterSequence:events.last?.sequence ?? 0,requestID:requestId,userMessageID:userMessageId,operation:operation,
            startedAt:startedAt,preparedUserMessage:preparedUserMessage,replacementTargetUserMessageID:replacementTargetUserMessageId,
            terminalFailure:failureCode,foregroundTurnCompleted:true)
    }
}
