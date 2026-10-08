import Foundation

extension LeileiAPIClient {
    func mindPage(
        kind: MindProductKind? = nil,
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
