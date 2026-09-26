import Foundation

protocol SettingsDataService {
    func exportData(_ request: SettingsExportRequest) async throws -> SettingsExportDocument
    func previewRestore(fileURL: URL) async throws -> SettingsRestorePreview
    func executeRestore(
        fileURL: URL,
        previewFingerprint: String
    ) async throws -> SettingsRestoreResult
    func readDataSummary() async throws -> SettingsDataSummary
    func readRuntimeStatus() async throws -> SettingsRuntimeStatus
    func readActivity() async throws -> [SettingsActivityRecord]
}

protocol SettingsAuthService {
    func signOut() async throws
}

enum SettingsDataServiceError: LocalizedError {
    case unavailable
    case unsupported

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "This service is unavailable on this device."
        case .unsupported:
            "This operation is not supported by the current runtime."
        }
    }
}

struct UnavailableSettingsDataService: SettingsDataService {
    func exportData(_ request: SettingsExportRequest) async throws -> SettingsExportDocument {
        throw SettingsDataServiceError.unavailable
    }

    func previewRestore(fileURL: URL) async throws -> SettingsRestorePreview {
        throw SettingsDataServiceError.unsupported
    }

    func executeRestore(
        fileURL: URL,
        previewFingerprint: String
    ) async throws -> SettingsRestoreResult {
        throw SettingsDataServiceError.unsupported
    }

    func readDataSummary() async throws -> SettingsDataSummary {
        throw SettingsDataServiceError.unavailable
    }

    func readRuntimeStatus() async throws -> SettingsRuntimeStatus {
        throw SettingsDataServiceError.unavailable
    }

    func readActivity() async throws -> [SettingsActivityRecord] {
        throw SettingsDataServiceError.unavailable
    }
}

struct UnavailableSettingsAuthService: SettingsAuthService {
    func signOut() async throws {
        throw SettingsDataServiceError.unavailable
    }
}

enum SettingsExportScope: String, CaseIterable, Identifiable, Hashable {
    case all
    case diary
    case todo

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .diary: "Diary"
        case .todo: "Todo"
        }
    }

    var backendScope: String { rawValue }
}

struct SettingsExportRequest {
    let scope: SettingsExportScope
    let includeAuditAndLifecycleEvents: Bool
}

struct SettingsExportDocument: Identifiable {
    let id = UUID()
    let fileURL: URL
}

struct SettingsRestorePreview {
    let newCount: Int
    let alreadyHereCount: Int
    let conflictCount: Int
    let invalidCount: Int
    let previewFingerprint: String
    let canExecute: Bool
}

struct SettingsRestoreResult {
    let completed: Bool
}

struct SettingsDataSummary {
    let diaryActive: Int
    let diaryArchived: Int
    let todoActive: Int
}

struct SettingsRuntimeStatus {
    let webAPI: String
    let chatGPTClaudeMCP: String
    let internalMCP: String
}

struct SettingsActivityRecord: Identifiable {
    let id: String
    let timestamp: Date
    let label: String
    let source: String
    let result: String
}


final class LeileiSettingsDataService: SettingsDataService {
    private let api: LeileiAPIClient

    init(api: LeileiAPIClient) {
        self.api = api
    }

    func exportData(
        _ request: SettingsExportRequest
    ) async throws -> SettingsExportDocument {
        let data = try await api.exportData(
            scope: request.scope.backendScope,
            includeAudit: request.includeAuditAndLifecycleEvents
        )
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "leileios-export-\(UUID().uuidString.lowercased()).json"
            )
        try data.write(to: url, options: .atomic)
        return SettingsExportDocument(fileURL: url)
    }

    func previewRestore(
        fileURL: URL
    ) async throws -> SettingsRestorePreview {
        let data = try Data(contentsOf: fileURL)
        let preview = try await api.previewImport(data)
        let counts = [preview.summary.diary, preview.summary.todo]

        return SettingsRestorePreview(
            newCount: counts.reduce(0) { $0 + $1.create },
            alreadyHereCount: counts.reduce(0) { $0 + $1.duplicate },
            conflictCount: counts.reduce(0) { $0 + $1.conflict },
            invalidCount: counts.reduce(0) { $0 + $1.invalid },
            previewFingerprint: preview.previewFingerprint,
            canExecute: preview.canExecute
        )
    }

    func executeRestore(
        fileURL: URL,
        previewFingerprint: String
    ) async throws -> SettingsRestoreResult {
        let data = try Data(contentsOf: fileURL)
        _ = try await api.executeImport(
            data,
            expectedPreviewFingerprint: previewFingerprint
        )
        return SettingsRestoreResult(completed: true)
    }

    func readDataSummary() async throws -> SettingsDataSummary {
        let summary = try await api.systemDataSummary()
        return SettingsDataSummary(
            diaryActive: summary.diary.active,
            diaryArchived: summary.diary.archived,
            todoActive: summary.todo.active
        )
    }

    func readRuntimeStatus() async throws -> SettingsRuntimeStatus {
        let status = try await api.systemConnections()
        return SettingsRuntimeStatus(
            webAPI: status.webAPI == "online" ? "Online" : status.webAPI,
            chatGPTClaudeMCP:
                status.publicMCP == "available"
                    ? "Available"
                    : status.publicMCP,
            internalMCP:
                status.internalMCP == "available"
                    ? "Available"
                    : status.internalMCP == "not_enabled"
                        ? "Not enabled"
                        : status.internalMCP
        )
    }

    func readActivity() async throws -> [SettingsActivityRecord] {
        let records = try await api.systemActivity()
        return records.compactMap { record in
            guard let timestamp = Self.parseTimestamp(record.occurredAt) else {
                return nil
            }
            return SettingsActivityRecord(
                id: record.id,
                timestamp: timestamp,
                label: record.label,
                source: record.source,
                result: record.outcome == "success" ? "Success" : "Failed"
            )
        }
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}
