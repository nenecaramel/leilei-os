import Foundation

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
            let raw = try JSONSerialization.jsonObject(
                with: data
            )
            guard let root = raw as? [String: Any],
                  !root.keys.contains("backups")
            else {
                throw UniverseImportValidationError.invalid
            }

            export = try decoder.decode(
                StandaloneUniverseExport.self,
                from: data
            )
        } catch {
            throw UniverseImportValidationError.invalid
        }

        guard export.schemaVersion == 2 else {
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
              snapshot.galaxies.count <= 10_000,
              snapshot.nodes.count <= 10_000,
              snapshot.relations.count <= 10_000,
              snapshot.revisions.count <= 10_000,
              validText(snapshot.meta.name),
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
            guard validNonBlank(galaxy.id, max: 256),
                  validText(galaxy.title),
                  validText(galaxy.description),
                  validText(galaxy.color, max: 128),
                  galaxy.order.isFinite
            else {
                throw UniverseImportValidationError.invalid
            }
        }

        for node in snapshot.nodes {
            guard validNonBlank(node.id, max: 256),
                  validText(node.title),
                  validText(node.summary),
                  validText(node.content),
                  validNonBlank(node.type, max: 128),
                  validTags(node.tags),
                  validMemberships(
                    node.galaxies,
                    galaxyIDs: galaxyIDs
                  ),
                  node.position.x.isFinite,
                  node.position.y.isFinite,
                  validTimestamp(node.createdAt),
                  validTimestamp(node.updatedAt),
                  validOptionalText(
                      node.importance,
                      max: 128
                  ),
                  validMigration(node.migration)
            else {
                throw UniverseImportValidationError.invalid
            }
        }

        var relationKeys = Set<String>()
        for relation in snapshot.relations {
            guard validNonBlank(relation.id, max: 256),
                  validNonBlank(relation.source, max: 256),
                  validNonBlank(relation.target, max: 256),
                  nodeIDs.contains(relation.source),
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
            guard validNonBlank(revision.id, max: 256),
                  validNonBlank(revision.nodeId, max: 256),
                  nodeIDs.contains(revision.nodeId),
                  validTimestamp(revision.createdAt),
                  validText(revision.reason, max: 1_000),
                  validRevisionSnapshot(
                      revision.snapshot,
                      galaxyIDs: galaxyIDs
                  )
            else {
                throw UniverseImportValidationError.invalid
            }
        }
    }

    private static func validRevisionSnapshot(
        _ snapshot: UniverseRevisionSnapshot,
        galaxyIDs: Set<String>
    ) -> Bool {
        validText(snapshot.title)
            && validText(snapshot.summary)
            && validText(snapshot.content)
            && validNonBlank(snapshot.type, max: 128)
            && validTags(snapshot.tags)
            && validMemberships(
                snapshot.galaxies,
                galaxyIDs: galaxyIDs
            )
            && validOptionalText(
                snapshot.importance,
                max: 128
            )
            && validMigration(snapshot.migration)
    }

    private static func validTags(
        _ tags: [String]
    ) -> Bool {
        tags.count <= 500
            && tags.allSatisfy {
                validNonBlank($0, max: 512)
            }
    }

    private static func validMemberships(
        _ memberships: [UniverseGalaxyMembership],
        galaxyIDs: Set<String>
    ) -> Bool {
        guard memberships.count <= 500,
              Set(memberships.map(\.id)).count
                == memberships.count
        else {
            return false
        }

        return memberships.allSatisfy {
            validNonBlank($0.id, max: 256)
                && $0.weight.isFinite
                && galaxyIDs.contains($0.id)
        }
    }

    private static func validMigration(
        _ migration: UniverseNodeMigration?
    ) -> Bool {
        guard let migration else {
            return true
        }

        return (
            migration.source == "mind-universe-static"
                || migration.source == "mind-universe"
        )
            && validTimestamp(migration.migratedAt)
    }

    private static func validOptionalText(
        _ value: String?,
        max: Int
    ) -> Bool {
        guard let value else {
            return true
        }

        return validText(
            value,
            max: max
        )
    }

    private static func validText(
        _ value: String,
        max: Int = 100_000
    ) -> Bool {
        value.utf16.count <= max
    }

    private static func validNonBlank(
        _ value: String,
        max: Int
    ) -> Bool {
        validText(value, max: max)
            && !value.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
    }

    private static func requireUnique(_ values: [String]) throws {
        guard Set(values).count == values.count else {
            throw UniverseImportValidationError.invalid
        }
    }

    private static func validTimestamp(_ value: String) -> Bool {
        guard validText(value, max: 128),
              value.contains("T")
        else {
            return false
        }

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
    }
}

