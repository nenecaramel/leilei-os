import Foundation

extension LeileiAPIClient {
    func workspaces(
        conversationID: UUID? = nil
    ) async throws -> [WorkspaceSummary] {
        var components = URLComponents()
        components.path = "/api/v1/workspaces"
        if let conversationID {
            components.queryItems = [
                URLQueryItem(
                    name: "conversation_id",
                    value: conversationID.uuidString.lowercased()
                )
            ]
        }
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: WorkspaceListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func workspace(
        workspaceID: String
    ) async throws -> WorkspaceSummary {
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            authenticated: true
        )
        return envelope.data
    }

    func createWorkspace(
        name: String,
        description: String? = nil,
        requestID: UUID
    ) async throws -> WorkspaceSummary {
        let body = try JSONEncoder().encode(
            WorkspaceCreateBody(
                name: name,
                description: description
            )
        )
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func updateWorkspace(
        workspaceID: String,
        expectedVersion: Int,
        name: String,
        description: String?
    ) async throws -> WorkspaceSummary {
        let body = try JSONEncoder().encode(
            WorkspaceUpdateBody(
                expectedVersion: expectedVersion,
                name: name,
                description: description
            )
        )
        let envelope: WorkspaceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func deleteWorkspace(
        workspaceID: String,
        expectedVersion: Int
    ) async throws {
        let body = try JSONEncoder().encode(
            VersionMutationBody(expectedVersion: expectedVersion)
        )
        let _: NoContentResponse = try await request(
            path: "/api/v1/workspaces/\(workspaceID)",
            method: "DELETE",
            body: body,
            authenticated: true
        )
    }

    func workspaceResources(
        workspaceID: String,
        kind: WorkspaceResourceKind? = nil
    ) async throws -> [WorkspaceResourceSummary] {
        var components = URLComponents()
        components.path = "/api/v1/workspaces/\(workspaceID)/resources"
        if let kind {
            components.queryItems = [
                URLQueryItem(name: "kind", value: kind.rawValue)
            ]
        }
        guard let path = components.string else {
            throw LeileiAPIError.invalidResponse
        }
        let envelope: WorkspaceResourceListEnvelope = try await request(
            path: path,
            authenticated: true
        )
        return envelope.data
    }

    func workspaceResource(
        workspaceID: String,
        resourceID: String
    ) async throws -> WorkspaceResource {
        let envelope: WorkspaceResourceEnvelope = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            authenticated: true
        )
        return envelope.data
    }

    func createWorkspaceResource(
        workspaceID: String,
        kind: WorkspaceResourceKind,
        key: String,
        title: String?,
        content: String?,
        metadata: [String: NativeLiveJSONValue] = [:],
        requestID: UUID
    ) async throws -> WorkspaceResource {
        let body = try JSONEncoder().encode(
            WorkspaceResourceCreateBody(
                kind: kind,
                key: key,
                title: title,
                content: content,
                metadata: metadata
            )
        )
        let envelope: WorkspaceResourceEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)/resources",
            method: "POST",
            body: body,
            authenticated: true,
            idempotencyKey: requestID.uuidString.lowercased()
        )
        return envelope.data
    }

    func updateWorkspaceResource(
        workspaceID: String,
        resourceID: String,
        expectedVersion: Int,
        title: String?,
        content: String?,
        metadata: [String: NativeLiveJSONValue]
    ) async throws -> WorkspaceResource {
        let body = try JSONEncoder().encode(
            WorkspaceResourceUpdateBody(
                expectedVersion: expectedVersion,
                title: title,
                content: content,
                metadata: metadata
            )
        )
        let envelope: WorkspaceResourceEnvelope = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            method: "PATCH",
            body: body,
            authenticated: true
        )
        return envelope.data
    }

    func deleteWorkspaceResource(
        workspaceID: String,
        resourceID: String,
        expectedVersion: Int
    ) async throws {
        let body = try JSONEncoder().encode(
            VersionMutationBody(expectedVersion: expectedVersion)
        )
        let _: NoContentResponse = try await request(
            path:
                "/api/v1/workspaces/\(workspaceID)"
                + "/resources/\(resourceID)",
            method: "DELETE",
            body: body,
            authenticated: true
        )
    }

    func workspaceConversations(
        workspaceID: String
    ) async throws -> [WorkspaceConversationSummary] {
        let envelope: WorkspaceConversationListEnvelope = try await request(
            path: "/api/v1/workspaces/\(workspaceID)/conversations",
            authenticated: true
        )
        return envelope.data
    }

    func attachConversationToWorkspace(
        workspaceID: String,
        conversationID: UUID
    ) async throws -> Bool {
        let envelope: WorkspaceConversationMutationEnvelope =
            try await request(
                path:
                    "/api/v1/workspaces/\(workspaceID)"
                    + "/conversations/"
                    + conversationID.uuidString.lowercased(),
                method: "PUT",
                authenticated: true
            )
        return envelope.data.applied
    }

    func detachConversationFromWorkspace(
        workspaceID: String,
        conversationID: UUID
    ) async throws -> Bool {
        let envelope: WorkspaceConversationMutationEnvelope =
            try await request(
                path:
                    "/api/v1/workspaces/\(workspaceID)"
                    + "/conversations/"
                    + conversationID.uuidString.lowercased(),
                method: "DELETE",
                authenticated: true
            )
        return envelope.data.applied
    }
}

private struct WorkspaceListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceSummary]
}

private struct WorkspaceEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WorkspaceSummary
}

private struct WorkspaceResourceListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceResourceSummary]
}

private struct WorkspaceResourceEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WorkspaceResource
}

private struct WorkspaceCreateBody: Encodable, Sendable {
    let name: String
    let description: String?
}

private struct WorkspaceUpdateBody: Encodable, Sendable {
    let expectedVersion: Int
    let name: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
        case name
        case description
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        try container.encode(name, forKey: .name)
        if let description {
            try container.encode(description, forKey: .description)
        } else {
            try container.encodeNil(forKey: .description)
        }
    }
}

private struct VersionMutationBody: Encodable, Sendable {
    let expectedVersion: Int

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
    }
}

private struct WorkspaceResourceCreateBody: Encodable, Sendable {
    let kind: WorkspaceResourceKind
    let key: String
    let title: String?
    let content: String?
    let metadata: [String: NativeLiveJSONValue]
}

private struct WorkspaceResourceUpdateBody: Encodable, Sendable {
    let expectedVersion: Int
    let title: String?
    let content: String?
    let metadata: [String: NativeLiveJSONValue]

    enum CodingKeys: String, CodingKey {
        case expectedVersion = "expected_version"
        case title
        case content
        case metadata
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        if let title {
            try container.encode(title, forKey: .title)
        } else {
            try container.encodeNil(forKey: .title)
        }
        if let content {
            try container.encode(content, forKey: .content)
        } else {
            try container.encodeNil(forKey: .content)
        }
        try container.encode(metadata, forKey: .metadata)
    }
}

private struct WorkspaceConversationListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: [WorkspaceConversationSummary]
}

private struct WorkspaceConversationMutationEnvelope: Decodable, Sendable {
    struct MutationData: Decodable, Sendable {
        let applied: Bool
    }

    let success: Bool
    let data: MutationData
}
