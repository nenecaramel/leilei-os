import SwiftUI

struct GlobalSearchView: View {
    private let service: any GlobalSearchService
    private let onOpenDiary: (DiaryNavigationTarget) -> Void
    private let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    private let onOpenUniverseNode: (String) -> Void

    @State private var query = ""
    @State private var modules = GlobalSearchModule.defaultModules
    @State private var timePreset: GlobalSearchTimePreset = .anyTime
    @State private var scope: GlobalSearchScope = .active
    @State private var mode: GlobalSearchMode = .normal
    @State private var state: SearchState = .idle
    @State private var searchTask: Task<Void, Never>?
    @State private var loadMoreTask: Task<Void, Never>?
    @State private var isLoadingMore = false
    @State private var loadMoreFailed = false

    init(
        service: any GlobalSearchService = UnavailableGlobalSearchService(),
        onOpenDiary:
            @escaping (DiaryNavigationTarget) -> Void = { _ in },
        onOpenDaySpace:
            @escaping (DaySpaceNavigationTarget) -> Void = { _ in },
        onOpenUniverseNode:
            @escaping (String) -> Void = { _ in }
    ) {
        self.service = service
        self.onOpenDiary = onOpenDiary
        self.onOpenDaySpace = onOpenDaySpace
        self.onOpenUniverseNode = onOpenUniverseNode
    }

    var body: some View {
        Group {
            switch state {
            case .idle:
                Color.clear

            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .results(let response):
                GlobalSearchResultsList(
                    response: response,
                    isLoadingMore: isLoadingMore,
                    loadMoreFailed: loadMoreFailed,
                    onLoadMore: {
                        loadMore(response)
                    },
                    onOpenDiary: onOpenDiary,
                    onOpenDaySpace: onOpenDaySpace,
                    onOpenUniverseNode: onOpenUniverseNode
                )

            case .noResults:
                AppStateSurface(title: "Nothing here")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .unavailable:
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    scheduleSearch()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .searchable(text: $query, prompt: "Search")
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onChange(of: modules) { _, _ in scheduleSearch() }
        .onChange(of: timePreset) { _, _ in scheduleSearch() }
        .onChange(of: scope) { _, _ in scheduleSearch() }
        .onChange(of: mode) { _, _ in scheduleSearch() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                GlobalSearchFiltersMenu(
                    modules: $modules,
                    timePreset: $timePreset,
                    scope: $scope,
                    mode: $mode
                )
            }

            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
            }
        }
        .onDisappear {
            searchTask?.cancel()
            loadMoreTask?.cancel()
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        loadMoreTask?.cancel()
        isLoadingMore = false
        loadMoreFailed = false

        guard let request = currentRequest else {
            state = .idle
            return
        }

        state = .loading

        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }

            do {
                let response = try await service.search(request)
                guard !Task.isCancelled else { return }
                state = response.results.isEmpty
                    ? .noResults
                    : .results(response)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                state = .unavailable
            }
        }
    }

    private func loadMore(_ response: GlobalSearchResponse) {
        guard !isLoadingMore,
              let cursor = response.nextCursor,
              let request = currentRequest
        else {
            return
        }

        loadMoreTask?.cancel()
        isLoadingMore = true
        loadMoreFailed = false

        loadMoreTask = Task {
            do {
                let next = try await service.search(
                    request,
                    cursor: cursor
                )
                guard !Task.isCancelled else { return }

                let existing = response.results
                let combined = uniqueResults(existing + next.results)

                state = .results(
                    GlobalSearchResponse(
                        results: combined,
                        count: combined.count,
                        hasMore: next.hasMore,
                        nextCursor: next.nextCursor,
                        searchedModules: next.searchedModules,
                        searchedScope: next.searchedScope
                    )
                )
                isLoadingMore = false
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                isLoadingMore = false
                loadMoreFailed = true
            }
        }
    }

    private var currentRequest: GlobalSearchRequest? {
        let trimmedQuery = query.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !trimmedQuery.isEmpty,
              !modules.isEmpty
        else {
            return nil
        }

        let dateRange = timePreset.dateRange()
        return GlobalSearchRequest(
            query: trimmedQuery,
            modules: modules,
            scope: scope,
            mode: mode,
            dateFrom: dateRange.dateFrom,
            dateTo: dateRange.dateTo
        )
    }

    private func uniqueResults(
        _ results: [GlobalSearchResultItem]
    ) -> [GlobalSearchResultItem] {
        var seen = Set<String>()
        return results.filter {
            seen.insert($0.id).inserted
        }
    }
}

private extension GlobalSearchView {
    enum SearchState {
        case idle
        case loading
        case results(GlobalSearchResponse)
        case noResults
        case unavailable
    }
}

private struct GlobalSearchResultsList: View {
    let response: GlobalSearchResponse
    let isLoadingMore: Bool
    let loadMoreFailed: Bool
    let onLoadMore: () -> Void
    let onOpenDiary: (DiaryNavigationTarget) -> Void
    let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    let onOpenUniverseNode: (String) -> Void

    private var groups: [GlobalSearchResultGroup] {
        GlobalSearchModule.allCases.compactMap { module in
            let items = response.results.filter {
                $0.entityType == module
            }
            return items.isEmpty
                ? nil
                : GlobalSearchResultGroup(
                    module: module,
                    items: items
                )
        }
    }

    var body: some View {
        List {
            ForEach(groups) { group in
                Section(group.module.title) {
                    ForEach(group.items) { result in
                        GlobalSearchResultRow(
                            result: result,
                            onOpenDiary: onOpenDiary,
                            onOpenDaySpace: onOpenDaySpace,
                            onOpenUniverseNode: onOpenUniverseNode
                        )
                    }
                }
            }

            if response.nextCursor != nil {
                Section {
                    Button(action: onLoadMore) {
                        HStack {
                            Spacer()

                            if isLoadingMore {
                                ProgressView()
                            } else {
                                Text(
                                    loadMoreFailed
                                        ? "Retry"
                                        : "Load More"
                                )
                            }

                            Spacer()
                        }
                    }
                    .disabled(isLoadingMore)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

private struct GlobalSearchResultGroup: Identifiable {
    let module: GlobalSearchModule
    let items: [GlobalSearchResultItem]

    var id: GlobalSearchModule { module }
}

private struct GlobalSearchResultRow: View {
    let result: GlobalSearchResultItem
    let onOpenDiary: (DiaryNavigationTarget) -> Void
    let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    let onOpenUniverseNode: (String) -> Void

    var body: some View {
        switch result.entityType {
        case .diary:
            Button {
                onOpenDiary(
                    DiaryNavigationTarget(
                        diaryID:
                            result.detailArguments?["id"]
                                ?? result.entityID,
                        scope:
                            result.detailArguments?["scope"]
                                ?? result.lifecycleStatus
                    )
                )
            } label: {
                GlobalSearchDiaryRow(
                    result: result
                )
            }
            .buttonStyle(.plain)

        case .todo:
            Button {
                guard let date =
                    result.detailArguments?["date"]
                else {
                    return
                }

                onOpenDaySpace(
                    DaySpaceNavigationTarget(
                        date: date,
                        author: result.author
                    )
                )
            } label: {
                GlobalSearchTodoRow(
                    result: result
                )
            }
            .buttonStyle(.plain)

        case .universe:
            Button {
                onOpenUniverseNode(
                    result.detailArguments?["id"]
                        ?? result.entityID
                )
            } label: {
                GlobalSearchUniverseRow(
                    result: result
                )
            }
            .buttonStyle(.plain)
        }
    }
}

private struct GlobalSearchDiaryRow: View {
    let result: GlobalSearchResultItem

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(result.stableName)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            GlobalSearchMetadataLine(
                left: GlobalSearchDate.row(result.businessTime),
                right: [
                    result.author,
                    result.lifecycleStatus == "archived"
                        ? "Archived"
                        : nil,
                ]
                .compactMap { $0 }
                .joined(separator: "  ")
            )
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct GlobalSearchTodoRow: View {
    let result: GlobalSearchResultItem

    private var primaryText: String {
        result.snippet.isEmpty
            ? result.stableName
            : result.snippet
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(primaryText)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            GlobalSearchMetadataLine(
                left: GlobalSearchDate.row(result.businessTime),
                right: result.author ?? ""
            )
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct GlobalSearchUniverseRow: View {
    let result: GlobalSearchResultItem

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(result.stableName)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            GlobalSearchMetadataLine(
                left: GlobalSearchDate.row(result.businessTime),
                right: result.matchedField.capitalized
            )
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

private struct GlobalSearchMetadataLine: View {
    let left: String
    let right: String

    var body: some View {
        HStack(spacing: 12) {
            Text(left)
                .fixedSize(horizontal: true, vertical: false)

            Spacer(minLength: 8)

            if !right.isEmpty {
                Text(right)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
}

private enum GlobalSearchDate {
    static func row(_ value: String) -> String {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let date = fractional.date(from: value)
            ?? standard.date(from: value)
        else {
            return ""
        }

        let components = Calendar.current.dateComponents(
            [.month, .day],
            from: date
        )
        guard let month = components.month,
              let day = components.day
        else {
            return ""
        }

        return "\(month)/\(day)"
    }
}
