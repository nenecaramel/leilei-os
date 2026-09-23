import Foundation

protocol SettingsDataService {
    func exportData(_ request: SettingsExportRequest) async throws -> SettingsExportDocument
    func previewRestore(fileURL: URL) async throws -> SettingsRestorePreview
    func executeRestore(fileURL: URL) async throws -> SettingsRestoreResult
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

    func executeRestore(fileURL: URL) async throws -> SettingsRestoreResult {
        throw SettingsDataServiceError.unsupported
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
    case memory
    case diary
    case task
    case todo
    case sharedPaper

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .memory: "Memory"
        case .diary: "Diary"
        case .task: "Task"
        case .todo: "Todo"
        case .sharedPaper: "Shared Paper"
        }
    }

    var backendScope: String {
        switch self {
        case .sharedPaper: "shared_paper"
        default: rawValue
        }
    }
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
}

struct SettingsRestoreResult {
    let completed: Bool
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
