import Foundation

nonisolated struct NativeLiveTaskSnapshot: Decodable, Sendable, Identifiable {
    let taskId: String
    let handle: String
    let active: Bool
    let status: String
    let stopStatus: String?
    let description: String?
    let summary: String?

    var id: String { handle }
    var title: String { description?.isEmpty == false ? description! : "Task" }
    var canStop: Bool { active && stopStatus == nil && !["completed", "failed", "stopped", "killed"].contains(status) }
    var statusLabel: String {
        if stopStatus == "requested" { return "Stop requested" }
        if stopStatus == "unknown" || status == "unknown" { return "Unavailable" }
        return status.capitalized
    }
}

nonisolated struct NativeLiveTaskReceipt: Decodable, Sendable {
    let generationId: String
    let tasks: [NativeLiveTaskSnapshot]?
    let output: String?
    let totalBytes: Int?
    let truncated: Bool?
    let accepted: Bool?
}
