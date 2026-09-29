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
        case .all: "Full Backup"
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

enum SettingsRestoreModule: String, Identifiable, Hashable {
    case diary
    case diaryComments = "diary_comments"
    case todo
    case workspaces
    case conversations
    case mind
    case universe

    var id: String { rawValue }

    var title: String {
        switch self {
        case .diary: "Diary"
        case .diaryComments: "Diary comments"
        case .todo: "Todo"
        case .workspaces: "Workspaces"
        case .conversations: "Conversations"
        case .mind: "Mind"
        case .universe: "Universe"
        }
    }
}

struct SettingsRestoreModuleResult: Identifiable, Hashable {
    let module: SettingsRestoreModule
    let newCount: Int
    let alreadyHereCount: Int
    let conflictCount: Int
    let invalidCount: Int

    var id: String { module.id }
}

struct SettingsRestorePreview {
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let auditIncluded: Bool
    let modules: [SettingsRestoreModuleResult]
    let previewFingerprint: String
    let canExecute: Bool

    var newCount: Int {
        modules.reduce(0) { $0 + $1.newCount }
    }

    var alreadyHereCount: Int {
        modules.reduce(0) { $0 + $1.alreadyHereCount }
    }

    var conflictCount: Int {
        modules.reduce(0) { $0 + $1.conflictCount }
    }

    var invalidCount: Int {
        modules.reduce(0) { $0 + $1.invalidCount }
    }
}

struct SettingsRestoreResult {
    let completed: Bool
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let auditIncluded: Bool
    let modules: [SettingsRestoreModuleResult]
}

struct SettingsDataSummary {
    let diaryActive: Int
    let diaryArchived: Int
    let diaryComments: Int
    let todo: Int
    let workspaces: Int
    let conversationsActive: Int
    let conversationsArchived: Int
    let mind: Int
    let universeNodes: Int
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
        let timestamp = Self.exportTimestamp(Date())
        let scopeLabel: String
        switch request.scope {
        case .all:
            scopeLabel = "full-backup"
        case .diary:
            scopeLabel = "diary"
        case .todo:
            scopeLabel = "todo"
        }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "leileios-\(scopeLabel)_\(timestamp).json"
            )
        try data.write(to: url, options: .atomic)
        return SettingsExportDocument(fileURL: url)
    }

    func previewRestore(
        fileURL: URL
    ) async throws -> SettingsRestorePreview {
        let data = try Data(contentsOf: fileURL)
        let preview = try await api.previewImport(data)

        return SettingsRestorePreview(
            schemaVersion: preview.schemaVersion,
            exportedAt: preview.exportedAt,
            rawBytes: preview.rawBytes,
            auditIncluded: preview.auditIncluded,
            modules: Self.restoreModules(
                summary: preview.summary,
                includedModules: preview.includedModules
            ),
            previewFingerprint: preview.previewFingerprint,
            canExecute: preview.canExecute
        )
    }

    func executeRestore(
        fileURL: URL,
        previewFingerprint: String
    ) async throws -> SettingsRestoreResult {
        let data = try Data(contentsOf: fileURL)
        let result = try await api.executeImport(
            data,
            expectedPreviewFingerprint: previewFingerprint
        )
        return SettingsRestoreResult(
            completed: true,
            schemaVersion: result.schemaVersion,
            exportedAt: result.exportedAt,
            rawBytes: result.rawBytes,
            auditIncluded: result.auditIncluded,
            modules: Self.restoreModules(
                summary: result.summary,
                includedModules: result.includedModules
            )
        )
    }

    func readDataSummary() async throws -> SettingsDataSummary {
        let summary = try await api.systemDataSummary()
        return SettingsDataSummary(
            diaryActive: summary.diary.active,
            diaryArchived: summary.diary.archived,
            diaryComments: summary.diaryComments.count,
            todo: summary.todo.count,
            workspaces: summary.workspaces.count,
            conversationsActive: summary.conversations.active,
            conversationsArchived: summary.conversations.archived,
            mind: summary.mind.count,
            universeNodes: summary.universe.nodes
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

    private static func restoreModules(
        summary: ImportSummarySnapshot,
        includedModules: [String]
    ) -> [SettingsRestoreModuleResult] {
        includedModules.compactMap { rawModule in
            guard let module = SettingsRestoreModule(rawValue: rawModule) else {
                return nil
            }

            let counts: ImportSummaryCountsSnapshot?
            switch module {
            case .diary:
                counts = summary.diary
            case .diaryComments:
                counts = summary.diaryComments
            case .todo:
                counts = summary.todo
            case .workspaces:
                counts = summary.workspaces
            case .conversations:
                counts = summary.conversations
            case .mind:
                counts = summary.mind
            case .universe:
                counts = summary.universe
            }

            let resolved = counts ?? ImportSummaryCountsSnapshot(
                create: 0,
                duplicate: 0,
                conflict: 0,
                invalid: 0
            )
            return SettingsRestoreModuleResult(
                module: module,
                newCount: resolved.create,
                alreadyHereCount: resolved.duplicate,
                conflictCount: resolved.conflict,
                invalidCount: resolved.invalid
            )
        }
    }

    private static func exportTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        return formatter.string(from: date)
    }

}


func settingsDataErrorMessage(_ error: Error) -> String {
    guard let apiError = error as? LeileiAPIError else {
        return error.localizedDescription
    }

    switch apiError {
    case .backend(_, let code, let message):
        switch code {
        case "EXPORT_IN_PROGRESS":
            return "A conversation or Mind update is still being finalized. Try again in a moment."
        case "EXPORT_TOO_LARGE":
            return "This backup is too large to export as one JSON file."
        case "INVALID_IMPORT_FILE":
            return "This file is not a valid LeileiOS backup."
        case "IMPORT_OWNER_MISMATCH":
            return "This backup belongs to a different account."
        case "IMPORT_CONFLICT":
            return "This backup conflicts with existing data. Existing data was not changed."
        case "IMPORT_PREVIEW_STALE":
            return "This restore preview is out of date. Choose the file again."
        case "IMPORT_NOTHING_TO_RESTORE":
            return "Everything in this backup is already here."
        case "IMPORT_VERIFY_FAILED":
            return "LeileiOS could not verify the restored data. Nothing was committed."
        default:
            return message ?? "This operation could not be completed."
        }
    default:
        return apiError.localizedDescription
    }
}
