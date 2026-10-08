import SwiftUI
struct MindUndatedList: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var rows: [MemorySearchPage.Entry] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var failed = false
    @State private var generation = 0
    @State private var reloadToken = UUID()
    var body: some View {
        List {
            ForEach(rows) { row in
                NavigationLink { MindMemoryReadView(id: row.id) { reloadToken = UUID() } } label: { Text(row.snippet).lineLimit(3) }
            }
            if failed { Button("Retry") { Task { await load(reset: rows.isEmpty) } } }
            if loading { ProgressView() }
            if !loading && !failed && rows.isEmpty { Text("No memories yet") }
            if cursor != nil { Button("More") { Task { await load(reset: false) } }.disabled(loading) }
        }
        .navigationTitle("未指定日期")
        .task(id: reloadToken) { await load(reset: true) }
        .refreshable { await load(reset: true) }
    }
    @MainActor private func load(reset: Bool) async {
        if !reset && loading { return }
        if reset { generation += 1 }
        let ticket = generation
        loading = true; failed = false
        defer { if ticket == generation { loading = false } }
        do {
            let page = try await appModel.api.memorySearch(undated: true, cursor: reset ? nil : cursor)
            guard ticket == generation, !Task.isCancelled else { return }
            if reset { rows = page.items } else { let ids = Set(rows.map(\.id)); rows += page.items.filter { !ids.contains($0.id) } }
            cursor = page.nextCursor
        } catch { if ticket == generation && !Task.isCancelled { failed = true } }
    }
}
struct MindMemoryReadView: View {
    @EnvironmentObject private var appModel: AppModel
    let id: String
    let onChanged: () -> Void
    @State private var item: MindProductItem?
    @State private var failed = false
    @State private var retry = 0
    var body: some View {
        Group {
            if let item { MindItemDetailView(initialItem: item, onDeleted: onChanged) }
            else if failed { Button("Retry") { retry += 1 } }
            else { ProgressView() }
        }.task(id: retry) {
            do { item = try await appModel.api.mindItem(stateID: id) } catch { failed = true }
        }
    }
}
