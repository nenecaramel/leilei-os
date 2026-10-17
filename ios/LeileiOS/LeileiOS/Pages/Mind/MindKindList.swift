import SwiftUI
import Foundation

struct MindMemoryListView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var items: [MindProductItem] = []
    @State private var nextCursor: String?
    @State private var totalCount: Int?
    @State private var loading = false
    @State private var loadingMore = false
    @State private var failed = false
    @State private var reloadToken = UUID()
    @State private var dateFilterPresented = false
    @State private var selectedDate: String?
    @State private var undatedOnly = false
    @State private var sort: MindListSort = .updatedDesc
    @State private var listGeneration = 0
    @State private var query = ""
    @State private var searchRows: [MemorySearchPage.Entry] = []
    @State private var searchCursor: String?
    @State private var searchLoading = false
    @State private var searchLoadingMore = false
    @State private var searchFailed = false
    @State private var searchRefreshFailed = false
    @State private var searchGeneration = 0
    @State private var listScrollPosition: String?
    @State private var searchScrollPosition: String?
    @State private var lastListTaskKey: String?
    @State private var lastSearchTaskKey: String?

    var body: some View {
        Group {
            if isSearching {
                searchContent
            } else if loading && items.isEmpty {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if failed && items.isEmpty {
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    reloadToken = UUID()
                }
            } else if items.isEmpty {
                AppStateSurface(title: "Nothing here")
            } else {
                List {
                    ForEach(items) { item in
                        NavigationLink {
                            MindItemDetailView(
                                initialItem: item,
                                onDeleted: {
                                    removeMindItem(id: item.id)
                                },
                                onUpdated: { updated in
                                    updateMindItem(updated)
                                }
                            )
                        } label: {
                            MindItemRow(item: item)
                        }
                        .id(item.id)
                    }

                    if nextCursor != nil {
                        Section {
                            Button("More") {
                                Task {
                                    await loadMore()
                                }
                            }
                            .disabled(loadingMore)
                            .frame(
                                maxWidth: .infinity,
                                alignment: .center
                            )
                        }
                    }
                }
                .listStyle(.plain)
                .scrollPosition(id: $listScrollPosition)
                .scrollContentBackground(.hidden)
                .background(Color(.systemBackground))
                .refreshable {
                    await reload(preservingContent: true)
                }
            }
        }
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            ToolbarItem(placement: .principal) {
                DiaryNavigationTitle(title: "Mind", count: totalCount)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort By", selection: $sort) {
                        ForEach(MindListSort.allCases, id: \.self) { order in
                            Text(order.displayName).tag(order)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                    Divider()
                    Button("Filter Date") {
                        dateFilterPresented = true
                    }
                    if selectedDate != nil {
                        Button("All Dates") {
                            selectedDate = nil
                        }
                    }
                    Divider()
                    Toggle("Undated Only", isOn: $undatedOnly)
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 13, weight: .light))
                }
                .accessibilityLabel("Sort Mind")
            }
        }
        .task(id: "\(sort.rawValue)|\(undatedOnly)|\(reloadToken)") {
            let taskKey = "\(sort.rawValue)|\(undatedOnly)|\(reloadToken)"
            // Popping a detail may reactivate .task; retain previously
            // appended cursor pages and the observed scroll position.
            guard lastListTaskKey != taskKey else { return }
            lastListTaskKey = taskKey
            listScrollPosition = nil
            await reload()
        }
        .sheet(isPresented: $dateFilterPresented) {
            MindDateFilter(selectedDate: selectedDate) { day in
                undatedOnly = false
                selectedDate = day
            }
        }
        .onChange(of: undatedOnly) { _, undated in
            if undated { selectedDate = nil }
        }
        .task(id: "\(query)|\(selectedDate ?? "")|\(undatedOnly)|\(reloadToken)") {
            let taskKey = "\(query)|\(selectedDate ?? "")|\(undatedOnly)|\(reloadToken)"
            guard lastSearchTaskKey != taskKey else { return }
            lastSearchTaskKey = taskKey
            searchScrollPosition = nil
            await searchIfNeeded()
        }
    }

    private var isSearching: Bool {
        selectedDate != nil || !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder
    private var searchContent: some View {
        if searchLoading && searchRows.isEmpty {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if searchFailed && searchRows.isEmpty {
            AppStateSurface(title: "Unavailable", actionTitle: "Retry") {
                Task { await searchIfNeeded(skipDelay: true) }
            }
        } else if searchRows.isEmpty {
            AppStateSurface(title: "Nothing here")
        } else {
            List {
                ForEach(searchRows) { row in
                    NavigationLink {
                        MindMemoryReadView(
                            id: row.id,
                            onChanged: {
                                removeMindItem(id: row.id)
                            },
                            onUpdated: { updated in
                                updateMindItem(updated)
                            }
                        )
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(row.snippet)
                                .foregroundStyle(.primary)
                                .lineLimit(3)
                            if let date = row.date {
                                Text(date)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .id(row.id)
                }
                if searchCursor != nil {
                    Button("More") {
                        Task { await loadMoreSearch() }
                    }
                    .disabled(searchLoadingMore)
                    .frame(maxWidth: .infinity, alignment: .center)
                }
                if searchFailed {
                    Button("Retry") {
                        Task {
                            if searchRefreshFailed {
                                await searchIfNeeded(skipDelay: true, preservingContent: true)
                            } else {
                                await loadMoreSearch()
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollPosition(id: $searchScrollPosition)
            .scrollContentBackground(.hidden)
            .background(Color(.systemBackground))
            .refreshable { await searchIfNeeded(skipDelay: true, preservingContent: true) }
        }
    }

    // An edit/delete should never discard earlier cursor pages or change
    // scroll state. Update only the affected stable row in either feed.
    @MainActor
    private func removeMindItem(id: String) {
        let oldCount = items.count
        items.removeAll { $0.id == id }
        searchRows.removeAll { $0.id == id }
        if items.count != oldCount {
            totalCount = totalCount.map { max(0, $0 - 1) }
        }
    }

    @MainActor
    private func updateMindItem(_ updated: MindProductItem) {
        if let index = items.firstIndex(where: { $0.id == updated.id }) {
            items[index] = updated
        }
        if let index = searchRows.firstIndex(where: { $0.id == updated.id }) {
            let oldRow = searchRows[index]
            searchRows[index] = MemorySearchPage.Entry(
                id: updated.id,
                snippet: MindPresentation.normalized(updated.text)
                    ?? oldRow.snippet,
                date: oldRow.date
            )
        }
    }

    @MainActor
    private func searchIfNeeded(skipDelay: Bool = false, preservingContent: Bool = false) async {
        guard !Task.isCancelled else { return }
        searchGeneration += 1
        let ticket = searchGeneration
        defer { if ticket == searchGeneration { searchLoading = false } }
        let requestedDate = selectedDate
        let requestedUndated = undatedOnly
        let requestedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchLoadingMore = false
        if !preservingContent {
            searchRows = []
            searchCursor = nil
        }
        searchFailed = false
        searchRefreshFailed = false
        guard isSearching else {
            searchLoading = false
            return
        }
        searchLoading = true
        if !skipDelay && !requestedQuery.isEmpty {
            do {
                try await Task.sleep(for: .milliseconds(250))
            } catch {
                return
            }
        }
        guard ticket == searchGeneration, !Task.isCancelled, requestedDate == selectedDate, requestedUndated == undatedOnly, requestedQuery == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        do {
            let page = try await appModel.api.memorySearch(
                query: requestedQuery,
                date: requestedDate,
                undated: requestedUndated
            )
            guard ticket == searchGeneration, !Task.isCancelled, requestedDate == selectedDate, requestedUndated == undatedOnly, requestedQuery == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            searchRows = page.items
            searchCursor = page.nextCursor
            if preservingContent { await reload(preservingContent: true) }
        } catch {
            guard ticket == searchGeneration, !Task.isCancelled, requestedDate == selectedDate, requestedUndated == undatedOnly, requestedQuery == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            searchFailed = true
            searchRefreshFailed = preservingContent
        }
    }

    @MainActor
    private func loadMoreSearch() async {
        guard !searchLoadingMore, !searchLoading, let cursor = searchCursor else {
            return
        }
        let ticket = searchGeneration
        let requestedDate = selectedDate
        let requestedUndated = undatedOnly
        let requestedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchLoadingMore = true
        searchFailed = false
        searchRefreshFailed = false
        defer { if ticket == searchGeneration { searchLoadingMore = false } }
        do {
            let page = try await appModel.api.memorySearch(
                query: requestedQuery,
                date: requestedDate,
                undated: requestedUndated,
                cursor: cursor
            )
            guard ticket == searchGeneration,
                  !Task.isCancelled,
                  requestedDate == selectedDate, requestedUndated == undatedOnly,
                  requestedQuery == query.trimmingCharacters(in: .whitespacesAndNewlines)
            else { return }
            var ids = Set(searchRows.map(\.id))
            searchRows.append(contentsOf: page.items.filter { ids.insert($0.id).inserted })
            searchCursor = page.nextCursor
        } catch {
            if ticket == searchGeneration, !Task.isCancelled { searchFailed = true }
        }
    }

    @MainActor
    private func reload(preservingContent: Bool = false) async {
        guard !Task.isCancelled else { return }
        listGeneration += 1
        let ticket = listGeneration
        let requestedSort = sort
        let requestedUndated = undatedOnly
        loading = true
        failed = false
        loadingMore = false
        if !preservingContent {
            items = []
            nextCursor = nil
        }
        defer {
            if ticket == listGeneration { loading = false }
        }
        do {
            let page = try await appModel.api.mindPage(
                kind: .memory,
                sort: requestedSort,
                undated: requestedUndated
            )
            guard ticket == listGeneration, !Task.isCancelled, requestedSort == sort, requestedUndated == undatedOnly else { return }
            items = page.items
            nextCursor = page.nextCursor
            totalCount = page.totalCount
        } catch {
            if ticket == listGeneration, !Task.isCancelled {
                failed = true
                if items.isEmpty { totalCount = nil }
            }
        }
    }

    @MainActor
    private func loadMore() async {
        guard !loadingMore,
              !loading,
              let nextCursor else {
            return
        }
        let requestedSort = sort
        let requestedUndated = undatedOnly
        let ticket = listGeneration
        loadingMore = true
        defer { if ticket == listGeneration { loadingMore = false } }

        do {
            let page = try await appModel.api.mindPage(
                kind: .memory,
                sort: requestedSort,
                undated: requestedUndated,
                cursor: nextCursor
            )
            guard ticket == listGeneration, !Task.isCancelled, requestedSort == sort, requestedUndated == undatedOnly else { return }
            let existing = Set(items.map(\.id))
            items.append(
                contentsOf: page.items.filter {
                    !existing.contains($0.id)
                }
            )
            self.nextCursor = page.nextCursor
            totalCount = page.totalCount
        } catch {
            return
        }
    }
}

private struct MindItemRow: View {
    let item: MindProductItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(displayText)
                .foregroundStyle(.primary)
                .lineLimit(3)

            HStack(spacing: 6) {
                Text(MindPresentation.sourceLabel(item.source))
                if let occurred = MindPresentation.dateText(
                    item.occurredAt
                ) {
                    Text("·")
                    Text(occurred)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var displayText: String {
        MindPresentation.normalized(item.text) ?? "Memory"
    }
}
