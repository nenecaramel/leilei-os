import SwiftUI

struct GlobalSearchView: View {
    private let service: any GlobalSearchService
    private let onOpenDiary: (DiaryNavigationTarget) -> Void
    private let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    private let onOpenUniverseNode: (String) -> Void
    @State private var memoryTarget: MemoryNavigationTarget?
    @State private var query = ""
    @State private var modules = GlobalSearchModule.defaultModules
    @State private var timePreset: GlobalSearchTimePreset = .anyTime
    @State private var customDateRangePresented = false
    @State private var customStartDate =
        Calendar.current.date(
            byAdding: .month,
            value: -1,
            to: .now
        ) ?? .now
    @State private var customEndDate = Date.now
    @State private var draftCustomStartDate =
        Calendar.current.date(
            byAdding: .month,
            value: -1,
            to: .now
        ) ?? .now
    @State private var draftCustomEndDate = Date.now
    @State private var scope: GlobalSearchScope = .active
    @State private var mode: GlobalSearchMode = .normal
    @State private var author: GlobalSearchAuthorFilter = .all
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
                    onOpenUniverseNode: onOpenUniverseNode,
                    onOpenMemory: { memoryTarget = MemoryNavigationTarget(id: $0) }
                )

            case .noResults:
                AppStateSurface(title: "Nothing here")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .queryTooLong:
                AppStateSurface(
                    title: "Search is too long"
                )
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
        .navigationDestination(item: $memoryTarget) { MindMemoryReadView(id: $0.id, onChanged: { memoryTarget = nil }) }
        .searchable(text: $query, prompt: "Search")
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onChange(of: modules) { _, _ in scheduleSearch() }
        .onChange(of: timePreset) { _, _ in scheduleSearch() }
        .onChange(of: scope) { _, _ in scheduleSearch() }
        .onChange(of: mode) { _, _ in scheduleSearch() }
        .onChange(of: author) { _, _ in scheduleSearch() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                GlobalSearchFiltersMenu(
                    modules: $modules,
                    timePreset: timeSelection,
                    scope: $scope,
                    mode: $mode,
                    author: $author
                )
            }

            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
            }
        }
        .sheet(isPresented: $customDateRangePresented) {
            GlobalSearchCustomDateRangeSheet(
                startDate: $draftCustomStartDate,
                endDate: $draftCustomEndDate
            ) {
                customStartDate = draftCustomStartDate
                customEndDate = draftCustomEndDate
                timePreset = .custom
            }
        }
        .onDisappear {
            searchTask?.cancel()
            loadMoreTask?.cancel()
            isLoadingMore = false
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        loadMoreTask?.cancel()
        isLoadingMore = false
        loadMoreFailed = false

        let normalizedQuery = query
            .precomposedStringWithCanonicalMapping
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )

        guard normalizedQuery.unicodeScalars.count <= 200 else {
            state = .queryTooLong
            return
        }

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
                        searchedScope: next.searchedScope,
                        searchedAuthor: next.searchedAuthor
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
        let trimmedQuery = query
            .precomposedStringWithCanonicalMapping
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        guard !trimmedQuery.isEmpty,
              !modules.isEmpty
        else {
            return nil
        }

        let dateRange = selectedDateRange
        return GlobalSearchRequest(
            query: trimmedQuery,
            modules: modules,
            scope: scope,
            mode: mode,
            author: author,
            dateFrom: dateRange.dateFrom,
            dateTo: dateRange.dateTo
        )
    }

    private var timeSelection:
        Binding<GlobalSearchTimePreset> {
        Binding(
            get: { timePreset },
            set: { selection in
                if selection == .custom {
                    draftCustomStartDate = customStartDate
                    draftCustomEndDate = customEndDate
                    customDateRangePresented = true
                } else {
                    timePreset = selection
                }
            }
        )
    }

    private var selectedDateRange:
        (dateFrom: String?, dateTo: String?) {
        guard timePreset == .custom else {
            return timePreset.dateRange()
        }

        let formatter = DateFormatter()
        formatter.calendar = .current
        formatter.locale =
            Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"

        return (
            formatter.string(from: customStartDate),
            formatter.string(from: customEndDate)
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
        case queryTooLong
        case unavailable
    }
}
