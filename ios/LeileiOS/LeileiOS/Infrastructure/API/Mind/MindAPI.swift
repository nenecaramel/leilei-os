import Foundation

extension LeileiAPIClient {
    func mindPage(
        kind: MindProductKind? = nil,
        sort: MindListSort = .updatedDesc,
        undated: Bool = false,
        limit: Int = 100,
        cursor: String? = nil
    ) async throws -> MindProductPage {
        guard (1...200).contains(limit) else {
            throw LeileiAPIError.invalidResponse
        }

        var components = URLComponents()
        components.path = "/api/v1/mind"
        var queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let kind {
            queryItems.append(
                URLQueryItem(name: "kind", value: kind.rawValue)
            )
        }
        if sort != .updatedDesc {
            queryItems.append(URLQueryItem(name: "sort", value: sort.rawValue))
        }
        if undated {
            queryItems.append(URLQueryItem(name: "undated", value: "true"))
        }
        if let cursor {
            guard !cursor.isEmpty else {
                throw LeileiAPIError.invalidResponse
            }
            queryItems.append(
                URLQueryItem(name: "cursor", value: cursor)
            )
        }
        components.queryItems = queryItems

        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }

        let envelope: MindProductPageEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func mindItem(
        stateID: String
    ) async throws -> MindProductItem {
        let envelope: MindProductItemEnvelope = try await request(
            path: "/api/v1/mind/\(stateID)",
            authenticated: true
        )
        return envelope.data
    }

    func createManualMind(
        kind: MindProductKind,
        text: String,
        occurredAt: Date? = nil,
        note: String? = nil,
        requestID: UUID
    ) async throws -> MindProductItem {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        let body = try JSONEncoder().encode(
            MindManualCreateBody(
                kind: kind,
                text: text,
                occurredAt: occurredAt.map(formatter.string(from:)),
                note: note
            )
        )
        let envelope: MindProductItemEnvelope = try await request(
            path: "/api/v1/mind",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func deleteMind(
        stateID: String
    ) async throws {
        let _: MindDeleteEnvelope = try await request(
            path: "/api/v1/mind/\(stateID)",
            method: "DELETE",
            authenticated: true
        )
    }

    func memorySearch(
        query: String? = nil,
        date: String? = nil,
        undated: Bool = false,
        cursor: String? = nil
    ) async throws -> MemorySearchPage {
        var components = URLComponents()
        components.path = "/api/v1/mind/search"
        components.queryItems = [
            URLQueryItem(name: "limit", value: "100")
        ]
        if let query, !query.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "query", value: query))
        }
        if let date {
            components.queryItems?.append(URLQueryItem(name: "date_from", value: date))
            components.queryItems?.append(URLQueryItem(name: "date_to", value: date))
        }
        if undated {
            components.queryItems?.append(URLQueryItem(name: "undated", value: "true"))
        }
        if let cursor {
            components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor))
        }
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: MemorySearchEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func memoryDay(_ date: String) async throws -> [MindProductItem] {
        var items: [MindProductItem] = []
        var cursor: String?
        repeat {
            try Task.checkCancellation()
            var components = URLComponents()
            components.path = "/api/v1/mind/days/\(date)"
            components.queryItems = [URLQueryItem(name: "limit", value: "200")]
            if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
            let envelope: MindProductPageEnvelope = try await request(path: components.string!, authenticated: true)
            items.append(contentsOf: envelope.data.items)
            cursor = envelope.data.nextCursor
        } while cursor != nil
        return items
    }

    func updateMemory(item: MindProductItem, text: String, occurredAt: Date?) async throws -> MindProductItem {
        guard let version = item.contentVersion else { throw LeileiAPIError.invalidResponse }
        let body = try JSONEncoder().encode(MemoryUpdateBody(expectedVersion: version, text: text == (item.text ?? "") ? nil : text, occurredAt: occurredAt, includeOccurredAt: occurredAt != MemoryDate.parse(item.occurredAt)))
        let envelope: MindProductItemEnvelope = try await request(path: "/api/v1/mind/\(item.id)", method: "PATCH", body: body, authenticated: true)
        return envelope.data
    }

    func mindWrites(
        messageID: String
    ) async throws -> MindProductMessageWriteProjection {
        let envelope: MindProductMessageWriteEnvelope =
            try await request(
                path:
                    "/api/v1/mind/writes/messages/"
                    + messageID,
                authenticated: true
            )
        return envelope.data
    }

}

private struct MindProductPageEnvelope: Decodable, Sendable {
    let success: Bool
    let data: MindProductPage
}

private struct MindProductItemEnvelope: Decodable, Sendable {
    let success: Bool
    let data: MindProductItem
}

private struct MindProductMessageWriteEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: MindProductMessageWriteProjection
}

private struct MindDeleteEnvelope: Decodable, Sendable {
    struct DeleteData: Decodable, Sendable {
        let deletedStateCount: Int
    }

    let success: Bool
    let data: DeleteData
}

private struct MindManualCreateBody: Encodable, Sendable {
    let kind: MindProductKind
    let text: String
    let occurredAt: String?
    let note: String?

    enum CodingKeys: String, CodingKey {
        case kind
        case text
        case occurredAt = "occurred_at"
        case note
    }
}

struct MemorySearchPage: Decodable, Sendable {
    struct Entry: Decodable, Sendable, Identifiable {
        let id: String
        let snippet: String
        let date: String?
    }
    let items: [Entry]
    let nextCursor: String?
}
private struct MemorySearchEnvelope: Decodable { let data: MemorySearchPage }
