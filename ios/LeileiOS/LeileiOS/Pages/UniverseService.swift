import Foundation

@MainActor
final class UniverseAPIService {
    enum InitializationError: Error {
        case notWritten
        case uncertain
        case alreadyInitialized
    }

    private let api: LeileiAPIClient

    init(api: LeileiAPIClient) {
        self.api = api
    }

    func load() async throws -> UniverseReadResult {
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe"
        )
        return envelope.data
    }

    func save(
        snapshot: UniverseSnapshot,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseSaveRequest(
                snapshot: snapshot,
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe",
            method: "PUT",
            body: body
        )
        return envelope.data
    }

    func createNode(
        _ node: UniverseNodeCreateInput,
        sourceDiaryIDs: [String],
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseCreateNodeRequest(
                node: node,
                sourceDiaryIDs: sourceDiaryIDs,
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe/nodes",
            method: "POST",
            body: body
        )
        return envelope.data
    }

    func updateNode(
        id: String,
        patch: UniverseNodePatch,
        sourceDiaryIDs: [String]?,
        reason: String,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseUpdateNodeRequest(
                patch: patch,
                sourceDiaryIDs: sourceDiaryIDs,
                reason: reason,
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe/nodes/\(encodePath(id))",
            method: "PATCH",
            body: body
        )
        return envelope.data
    }

    func deleteNode(
        id: String,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseExpectedVersionRequest(
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe/nodes/\(encodePath(id))",
            method: "DELETE",
            body: body
        )
        return envelope.data
    }

    func createRelation(
        _ relation: UniverseRelationCreateInput,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseCreateRelationRequest(
                relation: relation,
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe/relations",
            method: "POST",
            body: body
        )
        return envelope.data
    }

    func deleteRelation(
        id: String,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseExpectedVersionRequest(
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path: "/api/v1/universe/relations/\(encodePath(id))",
            method: "DELETE",
            body: body
        )
        return envelope.data
    }

    func restoreLatestRevision(
        nodeID: String,
        expectedVersion: Int
    ) async throws -> UniverseReadResult {
        let body = try JSONEncoder().encode(
            UniverseExpectedVersionRequest(
                expectedVersion: expectedVersion
            )
        )
        let envelope: UniverseEnvelope<UniverseReadResult> = try await api.request(
            path:
                "/api/v1/universe/nodes/"
                + encodePath(nodeID)
                + "/revisions/restore",
            method: "POST",
            body: body
        )
        return envelope.data
    }

    func latestRevision(
        nodeID: String
    ) async throws -> UniverseRevision {
        let envelope: UniverseEnvelope<UniverseRevision> = try await api.request(
            path:
                "/api/v1/universe/nodes/"
                + encodePath(nodeID)
                + "/revisions/latest"
        )
        return envelope.data
    }

    func searchDiarySources(
        query: String
    ) async throws -> [UniverseDiarySourceOption] {
        var components = URLComponents()
        components.path = "/api/v1/universe/diary-source-options"
        components.queryItems = [
            URLQueryItem(name: "q", value: query)
        ]
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope:
            UniverseEnvelope<[UniverseDiarySourceOption]> = try await api.request(
                path: path
            )
        return envelope.data
    }

    func initialize(
        _ snapshot: UniverseSnapshot
    ) async throws -> UniverseReadResult {
        do {
            _ = try await load()
            throw InitializationError.alreadyInitialized
        } catch let error as InitializationError {
            throw error
        } catch {
            guard isNotInitialized(error) else {
                throw InitializationError.uncertain
            }
        }

        var writeFailed = false
        do {
            _ = try await save(
                snapshot: snapshot,
                expectedVersion: 0
            )
        } catch {
            writeFailed = true
        }

        do {
            return try await load()
        } catch {
            if writeFailed, isNotInitialized(error) {
                throw InitializationError.notWritten
            }
            throw InitializationError.uncertain
        }
    }

    static func isNotInitialized(_ error: Error) -> Bool {
        guard case let LeileiAPIError.backend(_, code, _) = error else {
            return false
        }
        return code == "UNIVERSE_NOT_INITIALIZED"
    }

    static func isVersionConflict(_ error: Error) -> Bool {
        guard case let LeileiAPIError.backend(_, code, _) = error else {
            return false
        }
        return code == "VERSION_CONFLICT"
    }

    static func userMessage(for error: Error) -> String {
        if isVersionConflict(error) {
            return "Universe 已在其他设备发生变化，已重新读取。"
        }

        guard case let LeileiAPIError.backend(_, code, _) = error else {
            return "Universe 暂时无法读取，请稍后重试。"
        }

        switch code {
        case "RELATION_CONFLICT":
            return "这条思想连接已经存在。"
        case "NODE_CONFLICT":
            return "这颗星球已经存在。"
        case "REVISION_NOT_FOUND":
            return "没有可以恢复的上一版本。"
        default:
            return "Universe 暂时无法读取，请稍后重试。"
        }
    }

    private func encodePath(_ value: String) -> String {
        let allowed = CharacterSet(
            charactersIn:
                "abcdefghijklmnopqrstuvwxyz"
                + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                + "0123456789-._~"
        )
        return value.addingPercentEncoding(
            withAllowedCharacters: allowed
        ) ?? value
    }
}

private struct UniverseEnvelope<Value: Decodable>: Decodable {
    let success: Bool
    let data: Value
}

private struct UniverseExpectedVersionRequest: Encodable {
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
    }
}

private struct UniverseSaveRequest: Encodable {
    let snapshot: UniverseSnapshot
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case snapshot
        case expectedVersion = "expected_version"
    }
}

private struct UniverseCreateNodeRequest: Encodable {
    let node: UniverseNodeCreateInput
    let sourceDiaryIDs: [String]
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case node
        case sourceDiaryIDs = "source_diary_ids"
        case expectedVersion = "expected_version"
    }
}

private struct UniverseUpdateNodeRequest: Encodable {
    let patch: UniverseNodePatch
    let sourceDiaryIDs: [String]?
    let reason: String
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case patch
        case sourceDiaryIDs = "source_diary_ids"
        case reason
        case expectedVersion = "expected_version"
    }
}

private struct UniverseCreateRelationRequest: Encodable {
    let relation: UniverseRelationCreateInput
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case relation
        case expectedVersion = "expected_version"
    }
}
