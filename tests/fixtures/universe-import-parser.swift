import Foundation

@main
struct UniverseImportParserChecks {
    static let timestamp = "2026-08-01T00:00:00.123Z"
    static let offsetTimestamp = "2026-08-02T08:00:00+08:00"

    static func document() -> [String: Any] {
        let membership: [[String: Any]] = [["id": "g-a", "weight": 0.2718281828459]]
        let contents: [String: Any] = [
            "title": "节点", "summary": "summary", "content": "content",
            "type": "concept", "tags": ["tag"], "galaxies": membership,
            "importance": "anchor",
            "migration": ["source": "mind-universe-static", "migratedAt": timestamp],
        ]
        var node = contents
        node.merge([
            "id": "n-a", "position": ["x": 101.25, "y": -2.5],
            "createdAt": timestamp, "updatedAt": offsetTimestamp,
        ]) { _, new in new }
        return [
            "schemaVersion": 2,
            "meta": ["name": "Universe", "createdAt": timestamp,
                     "updatedAt": offsetTimestamp, "exportedAt": timestamp],
            "galaxies": [
                ["id": "g-a", "title": "A", "description": "", "color": "#fff", "order": 0],
                ["id": "g-b", "title": "B", "description": "", "color": "#ddd", "order": 1],
            ],
            "nodes": [node],
            "edges": [["id": "e-a", "source": "n-a", "target": "n-a",
                       "relationType": "related_to", "strength": 0.625, "createdAt": timestamp]],
            "revisions": [["id": "r-a", "nodeId": "n-a", "createdAt": timestamp,
                           "reason": "history", "snapshot": contents]],
        ]
    }

    static func parse(_ value: [String: Any]) throws -> UniverseImportPreview {
        try UniverseImportParser.parse(JSONSerialization.data(withJSONObject: value))
    }

    static func invalid(_ operation: () throws -> Void) {
        do {
            try operation()
            fatalError("Expected invalid import")
        } catch UniverseImportValidationError.invalid {
            precondition(errorText == "文件无法用于迁移")
        } catch {
            fatalError("Unexpected error type: \(error)")
        }
    }

    static var errorText: String? { UniverseImportValidationError.invalid.errorDescription }

    static func changedNode(_ key: String, _ value: Any) -> [String: Any] {
        var root = document()
        var nodes = root["nodes"] as! [[String: Any]]
        nodes[0][key] = value
        root["nodes"] = nodes
        return root
    }

    static func main() throws {
        switch CommandLine.arguments[1] {
        case "parse":
            let preview = try parse(document())
            precondition(preview.conversions == ["edges → relations"])
            precondition(preview.galaxies == 2 && preview.nodes == 1)
            precondition(preview.relations == 1 && preview.revisions == 1)
            precondition(preview.snapshot.meta.exportedAt == nil)
            precondition(preview.snapshot.meta.createdAt == timestamp)
            precondition(preview.snapshot.nodes[0].updatedAt == offsetTimestamp)
            precondition(preview.snapshot.nodes[0].position == UniversePosition(x: 101.25, y: -2.5))
            precondition(preview.snapshot.nodes[0].galaxies[0].weight == 0.2718281828459)
            precondition(preview.snapshot.revisions[0].snapshot.migration?.source == "mind-universe-static")
            precondition(preview.snapshot.relations[0].relationType == .relatedTo)
            var minimal = document()
            var nodes = minimal["nodes"] as! [[String: Any]]
            nodes[0].removeValue(forKey: "importance")
            nodes[0]["migration"] = NSNull()
            minimal["nodes"] = nodes
            minimal["unknownField"] = "ignored"
            let optional = try parse(minimal)
            precondition(optional.snapshot.nodes[0].importance == nil)
            precondition(optional.snapshot.nodes[0].migration == nil)
            let encoded = try JSONEncoder().encode(preview.snapshot)
            let decoded = try JSONDecoder().decode(UniverseSnapshot.self, from: encoded)
            precondition(decoded == preview.snapshot)
        case "invalid":
            invalid { _ = try UniverseImportParser.parse(Data("not JSON".utf8)) }
            invalid { _ = try UniverseImportParser.parse(Data("[]".utf8)) }
            for key in ["meta", "nodes", "edges", "revisions"] {
                var missing = document()
                missing.removeValue(forKey: key)
                invalid { _ = try parse(missing) }
            }
            for (key, value) in [("schemaVersion", 1 as Any), ("backups", [] as Any)] {
                var root = document()
                root[key] = value
                invalid { _ = try parse(root) }
            }
            for (key, value) in [
                ("createdAt", "2026-08-01" as Any), ("updatedAt", "bad" as Any),
                ("type", " " as Any), ("tags", [""] as Any),
                ("position", ["x": "bad", "y": 1] as Any),
                ("galaxies", [["id": "unknown", "weight": 1]] as Any),
                ("migration", ["source": "unknown", "migratedAt": timestamp] as Any),
            ] {
                invalid { _ = try parse(changedNode(key, value)) }
            }
        case "readback":
            let expected = try parse(document()).snapshot
            var actual = expected
            actual.meta.exportedAt = "ignored for readback"
            actual = UniverseSnapshot(schemaVersion: actual.schemaVersion, meta: actual.meta,
                galaxies: actual.galaxies.reversed(), nodes: actual.nodes,
                relations: actual.relations, revisions: actual.revisions)
            try UniverseImportParser.verify(expected: expected, actual: actual)
            var changed = document()
            var revisions = changed["revisions"] as! [[String: Any]]
            var content = revisions[0]["snapshot"] as! [String: Any]
            content["importance"] = "major"
            revisions[0]["snapshot"] = content
            changed["revisions"] = revisions
            let changedSnapshot = try parse(changed).snapshot
            invalid { try UniverseImportParser.verify(expected: expected, actual: changedSnapshot) }
            let changedNodeSnapshot = try parse(changedNode("title", "changed")).snapshot
            invalid { try UniverseImportParser.verify(expected: expected, actual: changedNodeSnapshot) }
        case "validation":
            invalid { _ = try parse(changedNode("content", String(repeating: "x", count: 100_001))) }
            invalid { _ = try parse(changedNode("tags", Array(repeating: "tag", count: 501))) }
            invalid { _ = try parse(changedNode("galaxies", [
                ["id": "g-a", "weight": 1], ["id": "g-a", "weight": 0.5],
            ])) }
            for key in ["galaxies", "nodes", "edges", "revisions"] {
                var root = document()
                var rows = root[key] as! [[String: Any]]
                rows.append(rows[0])
                root[key] = rows
                invalid { _ = try parse(root) }
            }
            for (collection, key) in [("edges", "target"), ("revisions", "nodeId")] {
                var root = document()
                var rows = root[collection] as! [[String: Any]]
                rows[0][key] = "missing-node"
                root[collection] = rows
                invalid { _ = try parse(root) }
            }
            var root = document()
            var edges = root["edges"] as! [[String: Any]]
            var duplicate = edges[0]
            duplicate["id"] = "e-b"
            edges.append(duplicate)
            root["edges"] = edges
            invalid { _ = try parse(root) }
        default:
            fatalError("Unknown check")
        }
        print("Universe import \(CommandLine.arguments[1]) PASS")
    }
}
