import SwiftUI

struct GlobalSearchResultsList: View {
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
                                        : "More"
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
