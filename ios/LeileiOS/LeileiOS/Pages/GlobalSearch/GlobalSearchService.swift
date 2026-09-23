import Foundation

enum GlobalSearchModule: String, CaseIterable, Identifiable, Hashable {
    case memory
    case diary
    case task
    case todo
    case universe
    case sharedPaper = "shared_paper"
    case conversation

    static let defaultModules: Set<GlobalSearchModule> = [
        .memory, .diary, .task, .todo, .universe, .sharedPaper,
    ]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .memory: "Memory"
        case .diary: "Diary"
        case .task: "Task"
        case .todo: "Todo"
        case .universe: "Universe"
        case .sharedPaper: "Shared Paper"
        case .conversation: "Conversation"
        }
    }
}

enum GlobalSearchScope: String, CaseIterable, Identifiable, Hashable {
    case all
    case active
    case archived

    var id: String { rawValue }

    var title: String { rawValue.capitalized }
}

enum GlobalSearchTimePreset: String, CaseIterable, Identifiable, Hashable {
    case anyTime
    case today
    case past7Days
    case past30Days

    var id: String { rawValue }

    var title: String {
        switch self {
        case .anyTime: "Any Time"
        case .today: "Today"
        case .past7Days: "Past 7 Days"
        case .past30Days: "Past 30 Days"
        }
    }

    /// The backend accepts calendar-date strings, inclusive at both ends.
    func dateRange(calendar: Calendar = .current, now: Date = .now) -> (dateFrom: String?, dateTo: String?) {
        guard self != .anyTime else { return (nil, nil) }

        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        let today = calendar.startOfDay(for: now)
        let daysBack = self == .today ? 0 : (self == .past7Days ? 6 : 29)
        let start = calendar.date(byAdding: .day, value: -daysBack, to: today) ?? today
        return (formatter.string(from: start), formatter.string(from: today))
    }
}

struct GlobalSearchRequest: Equatable {
    let query: String
    let modules: Set<GlobalSearchModule>
    let scope: GlobalSearchScope
    let dateFrom: String?
    let dateTo: String?
}

struct GlobalSearchResponse {
    let results: [GlobalSearchResultItem]
    let count: Int
    let hasMore: Bool
    let nextCursor: String?
    let searchedModules: [GlobalSearchModule]
    let searchedScope: GlobalSearchScope
}

struct GlobalSearchResultItem: Identifiable {
    let entityType: GlobalSearchModule
    let entityID: String
    let stableName: String
    let snippet: String
    let detailTool: String?
    let detailArguments: [String: String]?

    var id: String { "\(entityType.rawValue):\(entityID)" }
}

protocol GlobalSearchService {
    func search(_ request: GlobalSearchRequest) async throws -> GlobalSearchResponse
}

enum GlobalSearchServiceError: LocalizedError {
    case unavailable

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Global Search is unavailable on this device."
        }
    }
}

struct UnavailableGlobalSearchService: GlobalSearchService {
    func search(_ request: GlobalSearchRequest) async throws -> GlobalSearchResponse {
        throw GlobalSearchServiceError.unavailable
    }
}
