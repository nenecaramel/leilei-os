import Foundation

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
