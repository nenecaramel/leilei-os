import SwiftUI
import Foundation

struct MindMemoryListView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var items: [MindProductItem] = []
    @State private var nextCursor: String?
    @State private var loading = false
    @State private var loadingMore = false
    @State private var failed = false
    @State private var reloadToken = UUID()
    @State private var sort: MindListSort = .updatedDesc
    @State private var listGeneration = 0
    @State private var query = ""
    @State private var searchRows: [MemorySearchPage.Entry] = []
    @State private var searchCursor: String?
    @State private var searchLoading = false
    @State private var searchLoadingMore = false
    @State private var searchFailed = false
    @State private var searchGeneration = 0

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
                AppStateSurface(title: "No memories yet")
            } else {
                List {
                    ForEach(items) { item in
                        NavigationLink {
                            MindItemDetailView(
                                initialItem: item,
                                onDeleted: {
                                    reloadToken = UUID()
                                }
                            )
                        } label: {
                            MindItemRow(item: item)
                        }
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
                .scrollContentBackground(.hidden)
                .background(Color(.systemBackground))
                .refreshable {
                    await reload()
                }
            }
        }
        .searchable(text: $query, prompt: "Search")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort By", selection: $sort) {
                        ForEach(MindListSort.allCases, id: \.self) { order in
                            Text(order.displayName).tag(order)
                        }
                    }
                    .labelsHidden()
                    .pickerStyle(.inline)
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 15, weight: .light))
                }
                .accessibilityLabel("Mind 排序")
            }
        }
        .task(id: "\(sort.rawValue)|\(reloadToken)") {
            await reload()
        }
        .task(id: "\(query)|\(reloadToken)") {
            await searchIfNeeded()
        }
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
                        MindMemoryReadView(id: row.id) {
                            reloadToken = UUID()
                        }
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
                        Task { await loadMoreSearch() }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Color(.systemBackground))
            .refreshable { await searchIfNeeded(skipDelay: true) }
        }
    }

    @MainActor
    private func searchIfNeeded(skipDelay: Bool = false) async {
        searchGeneration += 1
        let ticket = searchGeneration
        searchRows = []
        searchCursor = nil
        searchFailed = false
        guard isSearching else {
            searchLoading = false
            return
        }
        searchLoading = true
        if !skipDelay {
            do {
                try await Task.sleep(for: .milliseconds(250))
            } catch {
                return
            }
        }
        guard ticket == searchGeneration, !Task.isCancelled else { return }
        do {
            let page = try await appModel.api.memorySearch(
                query: query.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            guard ticket == searchGeneration, !Task.isCancelled else { return }
            searchRows = page.items
            searchCursor = page.nextCursor
        } catch {
            guard ticket == searchGeneration, !Task.isCancelled else { return }
            searchFailed = true
        }
        if ticket == searchGeneration { searchLoading = false }
    }

    @MainActor
    private func loadMoreSearch() async {
        guard !searchLoadingMore, !searchLoading, let cursor = searchCursor else {
            return
        }
        let ticket = searchGeneration
        let requestedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchLoadingMore = true
        searchFailed = false
        defer { searchLoadingMore = false }
        do {
            let page = try await appModel.api.memorySearch(
                query: requestedQuery,
                cursor: cursor
            )
            guard ticket == searchGeneration,
                  !Task.isCancelled,
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
    private func reload() async {
        listGeneration += 1
        let ticket = listGeneration
        let requestedSort = sort
        loading = true
        failed = false
        items = []
        nextCursor = nil
        defer {
            if ticket == listGeneration { loading = false }
        }

        do {
            let page = try await appModel.api.mindPage(
                kind: .memory,
                sort: requestedSort
            )
            guard ticket == listGeneration, !Task.isCancelled else { return }
            items = page.items
            nextCursor = page.nextCursor
        } catch {
            if ticket == listGeneration, !Task.isCancelled { failed = true }
        }
    }

    @MainActor
    private func loadMore() async {
        guard !loadingMore,
              let nextCursor else {
            return
        }
        let requestedSort = sort
        let ticket = listGeneration
        loadingMore = true
        defer { loadingMore = false }

        do {
            let page = try await appModel.api.mindPage(
                kind: .memory,
                sort: requestedSort,
                cursor: nextCursor
            )
            guard ticket == listGeneration, !Task.isCancelled else { return }
            let existing = Set(items.map(\.id))
            items.append(
                contentsOf: page.items.filter {
                    !existing.contains($0.id)
                }
            )
            self.nextCursor = page.nextCursor
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

private struct MindMemoryReadView: View {
    @EnvironmentObject private var appModel: AppModel
    let id: String
    let onChanged: () -> Void

    @State private var item: MindProductItem?
    @State private var failed = false
    @State private var retryToken = UUID()

    var body: some View {
        Group {
            if let item {
                MindItemDetailView(initialItem: item, onDeleted: onChanged)
            } else if failed {
                AppStateSurface(title: "Unavailable", actionTitle: "Retry") {
                    retryToken = UUID()
                }
            } else {
                ProgressView()
            }
        }
        .task(id: retryToken) {
            do {
                let latest = try await appModel.api.mindItem(stateID: id)
                guard !Task.isCancelled else { return }
                item = latest
                failed = false
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}
