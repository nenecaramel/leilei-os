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
            return "Related to"
        case .supports:
            return "Supports"
        case .contradicts:
            return "Contradicts"
        case .extends:
            return "Extends"
        case .partOf:
            return "Part of"
        case .raises:
            return "Raises"
        }
    }

    var standaloneLabel: String {
        switch self {
        case .relatedTo:
            return "Related"
        case .contradicts:
            return "Contradicts"
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

    static func importanceLabel(_ value: String) -> String {
        switch value {
        case "anchor":
            return "Anchor"
        case "major":
            return "Major"
        case "normal":
            return "Normal"
        default:
            return value
        }
    }

    static func typeLabel(_ value: String) -> String {
        switch value {
        case "concept":
            return "Concept"
        case "question":
            return "Question"
        case "claim":
            return "Claim"
        case "experience":
            return "Experience"
        case "project":
            return "Project"
        case "source":
            return "Source"
        case "reflection":
            return "Reflection"
        default:
            return value
        }
    }
}
