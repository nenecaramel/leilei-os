import SwiftUI

struct MindMemoryListView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var items: [MindProductItem] = []
    @State private var nextCursor: String?
    @State private var loading = false
    @State private var loadingMore = false
    @State private var failed = false
    @State private var reloadToken = UUID()

    var body: some View {
        Group {
            if loading && items.isEmpty {
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
        .background(Color(.systemBackground))
        .task(id: reloadToken) {
            await reload()
        }
    }

    @MainActor
    private func reload() async {
        guard !loading else { return }
        loading = true
        failed = false
        defer { loading = false }

        do {
            let page = try await appModel.api.mindPage(
                kind: .memory
            )
            items = page.items
            nextCursor = page.nextCursor
        } catch {
            failed = true
        }
    }

    @MainActor
    private func loadMore() async {
        guard !loadingMore,
              let nextCursor else {
            return
        }
        loadingMore = true
        defer { loadingMore = false }

        do {
            let page = try await appModel.api.mindPage(
                kind: .memory,
                cursor: nextCursor
            )
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
                    item.occurredAt ?? item.createdAt,
                    date: .abbreviated,
                    time: .shortened
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
