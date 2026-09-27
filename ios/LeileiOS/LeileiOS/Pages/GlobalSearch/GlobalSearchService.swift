import Foundation

enum GlobalSearchModule: String, CaseIterable, Identifiable, Hashable, Codable {
    case diary
    case todo
    case universe

    static let defaultModules: Set<GlobalSearchModule> = [
        .diary, .todo, .universe,
    ]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .diary: "Diary"
        case .todo: "Todo"
        case .universe: "Universe"
        }
    }
}

enum GlobalSearchScope: String, CaseIterable, Identifiable, Hashable, Codable {
    case all
    case active
    case archived

    var id: String { rawValue }

    var title: String { rawValue.capitalized }
}

enum GlobalSearchMode: String, CaseIterable, Identifiable, Hashable, Codable {
    case normal
    case phrase

    var id: String { rawValue }

    var title: String {
        switch self {
        case .normal: "Normal"
        case .phrase: "Exact Phrase"
        }
    }
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

    func dateRange(
        calendar: Calendar = .current,
        now: Date = .now
    ) -> (dateFrom: String?, dateTo: String?) {
        guard self != .anyTime else { return (nil, nil) }

        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"

        let today = calendar.startOfDay(for: now)
        let daysBack = self == .today ? 0 : (self == .past7Days ? 6 : 29)
        let start = calendar.date(
            byAdding: .day,
            value: -daysBack,
            to: today
        ) ?? today

        return (
            formatter.string(from: start),
            formatter.string(from: today)
        )
    }
}

struct GlobalSearchRequest: Equatable {
    let query: String
    let modules: Set<GlobalSearchModule>
    let scope: GlobalSearchScope
    let mode: GlobalSearchMode
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

struct GlobalSearchResultItem: Identifiable, Decodable {
    let entityType: GlobalSearchModule
    let entityID: String
    let stableName: String
    let snippet: String
    let matchedField: String
    let matchReason: String
    let lifecycleStatus: String
    let businessTime: String
    let timeBasis: String
    let updatedAt: String
    let author: String?
    let detailTool: String?
    let detailArguments: [String: String]?

    var id: String { "\(entityType.rawValue):\(entityID)" }

    enum CodingKeys: String, CodingKey {
        case entityType = "entity_type"
        case entityID = "entity_id"
        case stableName = "stable_name"
        case snippet
        case matchedField = "matched_field"
        case matchReason = "match_reason"
        case lifecycleStatus = "lifecycle_status"
        case businessTime = "business_time"
        case timeBasis = "time_basis"
        case updatedAt = "updated_at"
        case author
        case detailTool = "detail_tool"
        case detailArguments = "detail_arguments"
    }
}

protocol GlobalSearchService {
    func search(
        _ request: GlobalSearchRequest,
        cursor: String?
    ) async throws -> GlobalSearchResponse
}

extension GlobalSearchService {
    func search(
        _ request: GlobalSearchRequest
    ) async throws -> GlobalSearchResponse {
        try await search(request, cursor: nil)
    }
}

enum GlobalSearchServiceError: LocalizedError {
    case unavailable
    case invalidRequest

    var errorDescription: String? {
        switch self {
        case .unavailable:
            "Global Search is unavailable on this device."
        case .invalidRequest:
            "The Global Search request is invalid."
        }
    }
}

struct UnavailableGlobalSearchService: GlobalSearchService {
    func search(
        _ request: GlobalSearchRequest,
        cursor: String?
    ) async throws -> GlobalSearchResponse {
        throw GlobalSearchServiceError.unavailable
    }
}

final class LeileiGlobalSearchService: GlobalSearchService {
    private let api: LeileiAPIClient

    init(api: LeileiAPIClient) {
        self.api = api
    }

    func search(
        _ request: GlobalSearchRequest,
        cursor: String?
    ) async throws -> GlobalSearchResponse {
        let orderedModules = GlobalSearchModule.allCases.filter {
            request.modules.contains($0)
        }
        guard !orderedModules.isEmpty else {
            throw GlobalSearchServiceError.invalidRequest
        }

        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "query", value: request.query),
            URLQueryItem(
                name: "modules",
                value: orderedModules.map(\.rawValue).joined(separator: ",")
            ),
            URLQueryItem(name: "scope", value: request.scope.rawValue),
            URLQueryItem(name: "mode", value: request.mode.rawValue),
            URLQueryItem(name: "limit", value: "25"),
        ]

        if let dateFrom = request.dateFrom {
            components.queryItems?.append(
                URLQueryItem(name: "date_from", value: dateFrom)
            )
        }
        if let dateTo = request.dateTo {
            components.queryItems?.append(
                URLQueryItem(name: "date_to", value: dateTo)
            )
        }
        if let cursor {
            components.queryItems?.append(
                URLQueryItem(name: "cursor", value: cursor)
            )
        }

        let envelope: GlobalSearchEnvelope = try await api.request(
            path: "/api/v1/search?\(components.percentEncodedQuery ?? "")"
        )

        return GlobalSearchResponse(
            results: envelope.data.results,
            count: envelope.data.metadata.count,
            hasMore: envelope.data.metadata.hasMore,
            nextCursor: envelope.data.metadata.nextCursor,
            searchedModules: envelope.data.metadata.searchedModules,
            searchedScope: envelope.data.metadata.searchedScope
        )
    }
}

private struct GlobalSearchEnvelope: Decodable {
    let success: Bool
    let data: GlobalSearchData
}

private struct GlobalSearchData: Decodable {
    let results: [GlobalSearchResultItem]
    let metadata: GlobalSearchMetadata
}

private struct GlobalSearchMetadata: Decodable {
    let count: Int
    let hasMore: Bool
    let nextCursor: String?
    let searchedModules: [GlobalSearchModule]
    let searchedScope: GlobalSearchScope

    enum CodingKeys: String, CodingKey {
        case count
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
        case searchedModules = "searched_modules"
        case searchedScope = "searched_scope"
    }
}
