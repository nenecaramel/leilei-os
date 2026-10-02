import Foundation

struct ImportSummaryCountsSnapshot: Decodable, Sendable, Equatable {
    let create: Int
    let duplicate: Int
    let conflict: Int
    let invalid: Int
}

struct ImportSummarySnapshot: Decodable, Sendable, Equatable {
    let diary: ImportSummaryCountsSnapshot
    let diaryComments: ImportSummaryCountsSnapshot?
    let todo: ImportSummaryCountsSnapshot
    let workspaces: ImportSummaryCountsSnapshot?
    let mind: ImportSummaryCountsSnapshot?
    let conversations: ImportSummaryCountsSnapshot?
    let universe: ImportSummaryCountsSnapshot?

    enum CodingKeys: String, CodingKey {
        case diary
        case diaryComments = "diary_comments"
        case todo
        case workspaces
        case mind
        case conversations
        case universe
    }
}

struct ImportPreviewSnapshot: Decodable, Sendable, Equatable {
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let includedModules: [String]
    let auditIncluded: Bool
    let packageSHA256: String
    let previewFingerprint: String
    let summary: ImportSummarySnapshot
    let canExecute: Bool

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case exportedAt = "exported_at"
        case rawBytes = "raw_bytes"
        case includedModules = "included_modules"
        case auditIncluded = "audit_included"
        case packageSHA256 = "package_sha256"
        case previewFingerprint = "preview_fingerprint"
        case summary
        case canExecute = "can_execute"
    }
}

struct ImportExecutionSnapshot: Decodable, Sendable, Equatable {
    let schemaVersion: Int
    let exportedAt: String
    let rawBytes: Int
    let includedModules: [String]
    let auditIncluded: Bool
    let packageSHA256: String
    let previewFingerprint: String
    let summary: ImportSummarySnapshot

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case exportedAt = "exported_at"
        case rawBytes = "raw_bytes"
        case includedModules = "included_modules"
        case auditIncluded = "audit_included"
        case packageSHA256 = "package_sha256"
        case previewFingerprint = "preview_fingerprint"
        case summary
    }
}
