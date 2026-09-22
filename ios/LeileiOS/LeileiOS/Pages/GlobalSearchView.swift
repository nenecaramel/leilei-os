import SwiftUI

struct GlobalSearchView: View {
    private let service: any GlobalSearchService

    @State private var query = ""
    @State private var modules = GlobalSearchModule.defaultModules
    @State private var timePreset: GlobalSearchTimePreset = .anyTime
    @State private var scope: GlobalSearchScope = .active
    @State private var state: SearchState = .idle
    @State private var searchTask: Task<Void, Never>?

    init(service: any GlobalSearchService = UnavailableGlobalSearchService()) {
        self.service = service
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
                List(response.results) { result in
                    GlobalSearchResultRow(result: result)
                }
                .listStyle(.plain)
            case .noResults:
                ContentUnavailableView.search(text: query)
            case .unavailable(let message):
                ContentUnavailableView(
                    "Global Search Unavailable",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            case .error(let message):
                ContentUnavailableView(
                    "Search Failed",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .searchable(text: $query, prompt: "Search LeileiOS")
        .onChange(of: query) { _, _ in scheduleSearch() }
        .onChange(of: modules) { _, _ in scheduleSearch() }
        .onChange(of: timePreset) { _, _ in scheduleSearch() }
        .onChange(of: scope) { _, _ in scheduleSearch() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                GlobalSearchFiltersMenu(
                    modules: $modules,
                    timePreset: $timePreset,
                    scope: $scope
                )
            }

            if #available(iOS 26.0, *) {
                DefaultToolbarItem(kind: .search, placement: .bottomBar)
            }
        }
        .onDisappear {
            searchTask?.cancel()
        }
    }

    private func scheduleSearch() {
        searchTask?.cancel()
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            state = .idle
            return
        }

        let dateRange = timePreset.dateRange()
        let request = GlobalSearchRequest(
            query: trimmedQuery,
            modules: modules,
            scope: scope,
            dateFrom: dateRange.dateFrom,
            dateTo: dateRange.dateTo
        )
        state = .loading

        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }

            do {
                let response = try await service.search(request)
                guard !Task.isCancelled else { return }
                state = response.results.isEmpty ? .noResults : .results(response)
            } catch is CancellationError {
                return
            } catch let error as GlobalSearchServiceError {
                state = .unavailable(error.localizedDescription)
            } catch {
                state = .error(error.localizedDescription)
            }
        }
    }
}

private extension GlobalSearchView {
    enum SearchState {
        case idle
        case loading
        case results(GlobalSearchResponse)
        case noResults
        case unavailable(String)
        case error(String)
    }
}

private struct GlobalSearchResultRow: View {
    let result: GlobalSearchResultItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(result.stableName)
                .font(.system(size: 17, weight: .medium))

            Text(result.entityType.title)
                .font(.system(size: 15, weight: .regular))
                .foregroundStyle(.secondary)

            if !result.snippet.isEmpty {
                Text(result.snippet)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
        }
        .padding(.vertical, 6)
        .accessibilityHint(result.detailTool ?? "")
    }
}
