import Foundation

extension LeileiAPIClient {
    func exportData() async throws -> Data {
        try await rawRequest(
            path: "/api/v1/system/export"
        )
    }

    func previewImport(_ data: Data) async throws -> ImportPreviewSnapshot {
        let response = try await rawRequest(
            path: "/api/v1/system/import/preview",
            method: "POST",
            body: data,
            contentType: "application/octet-stream"
        )
        return try JSONDecoder().decode(
            ImportPreviewEnvelope.self,
            from: response
        ).data
    }

    func executeImport(
        _ data: Data,
        expectedPreviewFingerprint: String
    ) async throws -> ImportExecutionSnapshot {
        let response = try await rawRequest(
            path: "/api/v1/system/import/execute?expected_preview_fingerprint=\(expectedPreviewFingerprint)",
            method: "POST",
            body: data,
            contentType: "application/octet-stream"
        )
        return try JSONDecoder().decode(
            ImportExecutionEnvelope.self,
            from: response
        ).data
    }
}

private struct ImportPreviewEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ImportPreviewSnapshot
}

private struct ImportExecutionEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ImportExecutionSnapshot
}
