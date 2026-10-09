import Foundation

struct SystemClaudeUsageWindowSnapshot: Decodable, Sendable, Equatable, Identifiable {
    let kind: String
    let utilization: Double?
    let resetsAt: String?

    var id: String { kind }

    enum CodingKeys: String, CodingKey {
        case kind
        case utilization
        case resetsAt = "resets_at"
    }
}

struct SystemClaudeUsageOverageSnapshot: Decodable, Sendable, Equatable {
    let status: String?
    let resetsAt: String?
    let disabledReason: String?
    let isUsing: Bool?

    enum CodingKeys: String, CodingKey {
        case status
        case resetsAt = "resets_at"
        case disabledReason = "disabled_reason"
        case isUsing = "is_using"
    }
}

struct SystemClaudeUsageSnapshot: Decodable, Sendable, Equatable {
    let provider: String
    let windows: [SystemClaudeUsageWindowSnapshot]
    let overage: SystemClaudeUsageOverageSnapshot?
    let observedAt: String

    enum CodingKeys: String, CodingKey {
        case provider
        case windows
        case overage
        case observedAt = "observed_at"
    }
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
    let conversations: Conversations
    let mind: Count
    let universe: Universe

    enum CodingKeys: String, CodingKey {
        case diary
        case diaryComments = "diary_comments"
        case todo
        case conversations
        case mind
        case universe
    }
}
