import Foundation

enum MindProductKind: String, CaseIterable, Codable, Sendable, Equatable, Identifiable {
    case memory

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        switch value {
        case "memory", "feel", "thought": self = .memory
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Mind kind"))
        }
    }

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

struct ClaudeAlbumMessageSaveProjection:
    Decodable,
    Sendable,
    Equatable {
    let userMessageId: String
    let total: Int
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
