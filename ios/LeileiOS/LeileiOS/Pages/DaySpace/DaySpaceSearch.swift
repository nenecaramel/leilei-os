import SwiftUI
import UIKit

struct DaySpaceTodoSearchRow: View {
    let entry: DaySpaceTodoSearchEntry

    private var metadataText: String {
        "\(entry.author.rawValue)  \(entry.kind.rawValue.capitalized)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(entry.text)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            HStack(spacing: 12) {
                Text(DaySpaceDate.rowLabel(entry.date))
                    .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 8)

                Text(metadataText)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

struct DaySpaceSearchContent: View {
    let searchState: DaySpaceTodoSearchState
    let searchHasMore: Bool
    let isLoadingMoreSearch: Bool
    let onOpenResult: (DaySpaceTodoSearchEntry) -> Void
    let onLoadMore: () -> Void
    let onRetry: () -> Void

    @ViewBuilder
    var body: some View {
        switch searchState {
        case .idle, .loading:
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .results(let entries):
            List {
                ForEach(entries) { entry in
                    Button {
                        onOpenResult(entry)
                    } label: {
                        DaySpaceTodoSearchRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                }

                if searchHasMore {
                    Button {
                        onLoadMore()
                    } label: {
                        HStack(spacing: 8) {
                            if isLoadingMoreSearch {
                                ProgressView()
                                    .controlSize(.small)
                            }

                            Text("More")
                        }
                        .frame(
                            maxWidth: .infinity,
                            alignment: .center
                        )
                    }
                    .disabled(isLoadingMoreSearch)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(.systemBackground))

        case .noResults:
            AppStateSurface(title: "Nothing here")
                .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .unavailable:
            AppStateSurface(
                title: "Unavailable",
                actionTitle: "Retry"
            ) {
                onRetry()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
