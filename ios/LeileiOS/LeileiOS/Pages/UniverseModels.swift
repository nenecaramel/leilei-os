import Foundation

struct UniversePosition: Codable, Equatable, Sendable {
    var x: Double
    var y: Double

    func clamped() -> UniversePosition {
        UniversePosition(
            x: min(100, max(0, x.isFinite ? x : 0)),
            y: min(100, max(0, y.isFinite ? y : 0))
        )
    }
}

struct UniverseGalaxyMembership: Codable, Equatable, Sendable, Identifiable {
    let id: String
    var weight: Double
}

struct UniverseNodeMigration: Codable, Equatable, Sendable {
    let source: String
    let migratedAt: String
}

struct UniverseNode: Codable, Equatable, Sendable, Identifiable {
    let id: String
    var title: String
    var summary: String
    var content: String
    var type: String
    var tags: [String]
    var galaxies: [UniverseGalaxyMembership]
    var position: UniversePosition
    let createdAt: String
    var updatedAt: String
    var importance: String?
    var migration: UniverseNodeMigration?
}

struct UniverseNodeCreateInput: Codable, Equatable, Sendable {
    var title: String
    var summary: String
    var content: String
    var type: String
    var tags: [String]
    var galaxies: [UniverseGalaxyMembership]
    var position: UniversePosition
    var importance: String?
}

struct UniverseNodePatch: Codable, Equatable, Sendable {
    var title: String?
    var summary: String?
    var content: String?
    var type: String?
    var tags: [String]?
    var galaxies: [UniverseGalaxyMembership]?
    var position: UniversePosition?
    var importance: String?
}

enum UniverseRelationType: String, Codable, CaseIterable, Identifiable, Sendable {
    case relatedTo = "related_to"
    case supports
    case contradicts
    case extends
    case partOf = "part_of"
    case raises

    var id: String { rawValue }

    var label: String {
        switch self {
        case .relatedTo:
            return "相关"
        case .supports:
            return "支持"
        case .contradicts:
            return "矛盾"
        case .extends:
            return "延伸"
        case .partOf:
            return "属于"
        case .raises:
            return "引出"
        }
    }

    var standaloneLabel: String {
        switch self {
        case .relatedTo:
            return "彼此相关"
        case .contradicts:
            return "彼此矛盾"
        default:
            return label
        }
    }
}

struct UniverseRelation: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let source: String
    let target: String
    let relationType: UniverseRelationType
    let strength: Double
    let createdAt: String
}

struct UniverseRelationCreateInput: Codable, Equatable, Sendable {
    let source: String
    let target: String
    let relationType: UniverseRelationType
    let strength: Double
}

struct UniverseGalaxy: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let title: String
    let description: String
    let color: String
    let order: Double
}

struct UniverseMeta: Codable, Equatable, Sendable {
    let name: String
    let createdAt: String
    let updatedAt: String
    var exportedAt: String?
}

struct UniverseRevisionSnapshot: Codable, Equatable, Sendable {
    let title: String
    let summary: String
    let content: String
    let type: String
    let tags: [String]
    let galaxies: [UniverseGalaxyMembership]
    let importance: String?
    let migration: UniverseNodeMigration?
}

struct UniverseRevision: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let nodeId: String
    let createdAt: String
    let reason: String
    let snapshot: UniverseRevisionSnapshot
}

struct UniverseSnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    var meta: UniverseMeta
    let galaxies: [UniverseGalaxy]
    let nodes: [UniverseNode]
    let relations: [UniverseRelation]
    let revisions: [UniverseRevision]
}

struct UniverseNodeConnection: Identifiable, Equatable, Sendable {
    let relation: UniverseRelation
    let node: UniverseNode

    var id: String { relation.id }
}

struct UniverseDiarySourceSummary: Codable, Equatable, Sendable, Identifiable {
    let nodeId: String
    let diaryId: String
    let title: String
    let date: String
    let status: String

    var id: String { "\(nodeId):\(diaryId)" }
}

struct UniverseDiarySourceOption: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let title: String
    let date: String
    let status: String
}

struct UniverseReadResult: Codable, Equatable, Sendable {
    let snapshot: UniverseSnapshot
    let version: Int
    let sources: [UniverseDiarySourceSummary]?
}

struct UniverseBackup: Codable, Equatable, Sendable, Identifiable {
    let id: String
    let createdAt: String
    let reason: String
    let data: UniverseSnapshot
}

struct UniverseViewport: Codable, Equatable, Sendable {
    var x: Double
    var y: Double
    var scale: Double

    static let minimumScale = 0.2
    static let maximumScale = 4.0

    func clamped() -> UniverseViewport {
        UniverseViewport(
            x: x.isFinite ? x : 0,
            y: y.isFinite ? y : 0,
            scale: min(
                Self.maximumScale,
                max(Self.minimumScale, scale.isFinite ? scale : 1)
            )
        )
    }
}

struct UniverseImportPreview: Equatable, Sendable {
    let snapshot: UniverseSnapshot
    let conversions: [String]

    var galaxies: Int { snapshot.galaxies.count }
    var nodes: Int { snapshot.nodes.count }
    var relations: Int { snapshot.relations.count }
    var revisions: Int { snapshot.revisions.count }
}

enum UniverseImportValidationError: LocalizedError {
    case invalid

    var errorDescription: String? {
        "文件无法用于迁移"
    }
}

enum UniverseImportParser {
    static func parse(_ data: Data) throws -> UniverseImportPreview {
        let decoder = JSONDecoder()
        let export: StandaloneUniverseExport

        do {
            export = try decoder.decode(
                StandaloneUniverseExport.self,
                from: data
            )
        } catch {
            throw UniverseImportValidationError.invalid
        }

        guard export.schemaVersion == 2,
              export.backups == nil
        else {
            throw UniverseImportValidationError.invalid
        }

        let snapshot = UniverseSnapshot(
            schemaVersion: 2,
            meta: UniverseMeta(
                name: export.meta.name,
                createdAt: export.meta.createdAt,
                updatedAt: export.meta.updatedAt,
                exportedAt: nil
            ),
            galaxies: export.galaxies,
            nodes: export.nodes,
            relations: export.edges,
            revisions: export.revisions
        )

        try validate(snapshot)

        return UniverseImportPreview(
            snapshot: snapshot,
            conversions: ["edges → relations"]
        )
    }

    static func verify(
        expected: UniverseSnapshot,
        actual: UniverseSnapshot
    ) throws {
        try validate(expected)
        try validate(actual)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        let normalizedExpected = normalized(expected)
        let normalizedActual = normalized(actual)

        guard try encoder.encode(normalizedExpected)
            == encoder.encode(normalizedActual)
        else {
            throw UniverseImportValidationError.invalid
        }
    }

    private static func validate(_ snapshot: UniverseSnapshot) throws {
        guard snapshot.schemaVersion == 2,
              validTimestamp(snapshot.meta.createdAt),
              validTimestamp(snapshot.meta.updatedAt)
        else {
            throw UniverseImportValidationError.invalid
        }

        try requireUnique(snapshot.galaxies.map(\.id))
        try requireUnique(snapshot.nodes.map(\.id))
        try requireUnique(snapshot.relations.map(\.id))
        try requireUnique(snapshot.revisions.map(\.id))

        let galaxyIDs = Set(snapshot.galaxies.map(\.id))
        let nodeIDs = Set(snapshot.nodes.map(\.id))

        for galaxy in snapshot.galaxies {
            guard !galaxy.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  galaxy.order.isFinite
            else {
                throw UniverseImportValidationError.invalid
            }
        }

        for node in snapshot.nodes {
            guard !node.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !node.type.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  node.position.x.isFinite,
                  node.position.y.isFinite,
                  validTimestamp(node.createdAt),
                  validTimestamp(node.updatedAt)
            else {
                throw UniverseImportValidationError.invalid
            }

            try requireUnique(node.galaxies.map(\.id))
            guard node.galaxies.allSatisfy({
                galaxyIDs.contains($0.id) && $0.weight.isFinite
            }) else {
                throw UniverseImportValidationError.invalid
            }

            if let migration = node.migration {
                guard migration.source == "mind-universe-static"
                    || migration.source == "mind-universe",
                      validTimestamp(migration.migratedAt)
                else {
                    throw UniverseImportValidationError.invalid
                }
            }
        }

        var relationKeys = Set<String>()
        for relation in snapshot.relations {
            guard nodeIDs.contains(relation.source),
                  nodeIDs.contains(relation.target),
                  relation.strength.isFinite,
                  validTimestamp(relation.createdAt)
            else {
                throw UniverseImportValidationError.invalid
            }

            let key = [
                relation.source,
                relation.target,
                relation.relationType.rawValue,
            ].joined(separator: "\u{0}")

            guard relationKeys.insert(key).inserted else {
                throw UniverseImportValidationError.invalid
            }
        }

        for revision in snapshot.revisions {
            guard nodeIDs.contains(revision.nodeId),
                  validTimestamp(revision.createdAt)
            else {
                throw UniverseImportValidationError.invalid
            }

            try requireUnique(revision.snapshot.galaxies.map(\.id))
            guard revision.snapshot.galaxies.allSatisfy({
                galaxyIDs.contains($0.id) && $0.weight.isFinite
            }) else {
                throw UniverseImportValidationError.invalid
            }
        }
    }

    private static func requireUnique(_ values: [String]) throws {
        guard Set(values).count == values.count else {
            throw UniverseImportValidationError.invalid
        }
    }

    private static func validTimestamp(_ value: String) -> Bool {
        guard value.contains("T") else { return false }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        return fractional.date(from: value) != nil
            || standard.date(from: value) != nil
    }

    private static func normalized(
        _ snapshot: UniverseSnapshot
    ) -> UniverseSnapshot {
        UniverseSnapshot(
            schemaVersion: snapshot.schemaVersion,
            meta: UniverseMeta(
                name: snapshot.meta.name,
                createdAt: snapshot.meta.createdAt,
                updatedAt: snapshot.meta.updatedAt,
                exportedAt: nil
            ),
            galaxies: snapshot.galaxies.sorted { $0.id < $1.id },
            nodes: snapshot.nodes.sorted { $0.id < $1.id },
            relations: snapshot.relations.sorted { $0.id < $1.id },
            revisions: snapshot.revisions.sorted { $0.id < $1.id }
        )
    }

    private struct StandaloneUniverseExport: Decodable {
        let schemaVersion: Int
        let meta: UniverseMeta
        let galaxies: [UniverseGalaxy]
        let nodes: [UniverseNode]
        let edges: [UniverseRelation]
        let revisions: [UniverseRevision]
        let backups: [UniverseBackup]?
    }
}

struct UniverseExportPayload: Encodable, Sendable {
    let schemaVersion: Int
    let meta: UniverseMeta
    let galaxies: [UniverseGalaxy]
    let nodes: [UniverseNode]
    let relations: [UniverseRelation]
    let revisions: [UniverseRevision]

    init(
        snapshot: UniverseSnapshot,
        exportedAt: String
    ) {
        schemaVersion = snapshot.schemaVersion
        var meta = snapshot.meta
        meta.exportedAt = exportedAt
        self.meta = meta
        galaxies = snapshot.galaxies
        nodes = snapshot.nodes
        relations = snapshot.relations
        revisions = snapshot.revisions
    }
}

enum UniverseNodeOptions {
    static let types = [
        "concept",
        "question",
        "claim",
        "experience",
        "project",
        "source",
        "reflection",
    ]

    static let importance = [
        "anchor",
        "major",
        "normal",
    ]

    static func typeLabel(_ value: String) -> String {
        switch value {
        case "concept":
            return "概念"
        case "question":
            return "问题"
        case "claim":
            return "观点"
        case "experience":
            return "经历"
        case "project":
            return "项目"
        case "source":
            return "来源"
        case "reflection":
            return "反思"
        default:
            return value
        }
    }
}
