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
    let contentVersion: String?
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

struct MemoryUpdateBody: Encodable {
    let expectedVersion: String
    let text: String?
    let occurredAt: Date?
    var includeOccurredAt = true
    enum CodingKeys: String, CodingKey { case expectedVersion = "expected_version", text, occurredAt = "occurred_at" }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(expectedVersion, forKey: .expectedVersion)
        if let text { try values.encode(text, forKey: .text) }
        guard includeOccurredAt else { return }
        if let occurredAt {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try values.encode(formatter.string(from: occurredAt), forKey: .occurredAt)
        } else { try values.encodeNil(forKey: .occurredAt) }
    }
}

enum MemoryDate {
    static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
