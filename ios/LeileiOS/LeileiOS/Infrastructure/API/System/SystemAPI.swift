import Foundation

extension LeileiAPIClient {
    func systemClaudeUsage() async throws -> SystemClaudeUsageSnapshot? {
        let envelope: SystemClaudeUsageEnvelope = try await request(
            path: "/api/v1/system/claude-usage",
            authenticated: true
        )
        return envelope.data
    }

    func systemConnections() async throws -> SystemConnectionsSnapshot {
        let envelope: SystemConnectionsEnvelope = try await request(
            path: "/api/v1/system/connections",
            authenticated: true
        )
        return envelope.data
    }

    func systemDataSummary() async throws -> SystemDataSummarySnapshot {
        let envelope: SystemDataSummaryEnvelope = try await request(
            path: "/api/v1/system/data",
            authenticated: true
        )
        return envelope.data
    }

}

private struct SystemClaudeUsageEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SystemClaudeUsageSnapshot?
}

private struct SystemConnectionsEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SystemConnectionsSnapshot
}

private struct SystemDataSummaryEnvelope: Decodable, Sendable {
    let success: Bool
    let data: SystemDataSummarySnapshot
}
