import SwiftUI

struct GlobalSearchResultRow: View {
    let result: GlobalSearchResultItem
    let onOpenDiary: (DiaryNavigationTarget) -> Void
    let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    let onOpenUniverseNode: (String) -> Void
    let onOpenMemory: (String) -> Void

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

        case .mind:
            Button { onOpenMemory(result.entityID) } label: {
                GlobalSearchResultContent(title: result.snippet, snippet: "", date: result.businessTime, metadata: "", timeZone: TimeZone(identifier: "Asia/Shanghai"))
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
        GlobalSearchResultContent(
            title: result.stableName,
            snippet: result.snippet,
            date: result.businessTime,
            metadata: [
                result.author,
                result.lifecycleStatus == "archived"
                    ? "Archived"
                    : nil,
            ]
            .compactMap { $0 }
            .joined(separator: "  ")
        )
    }
}

private struct GlobalSearchTodoRow: View {
    let result: GlobalSearchResultItem

    var body: some View {
        GlobalSearchResultContent(
            title: result.stableName,
            snippet: result.snippet,
            date: result.businessTime,
            metadata: result.author ?? ""
        )
    }
}

private struct GlobalSearchUniverseRow: View {
    let result: GlobalSearchResultItem

    var body: some View {
        GlobalSearchResultContent(
            title: result.stableName,
            snippet: result.snippet,
            date: result.businessTime,
            metadata: result.matchedField.capitalized
        )
    }
}

private struct GlobalSearchResultContent: View {
    let title: String
    let snippet: String
    let date: String?
    let metadata: String
    var timeZone: TimeZone? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            if !snippet.isEmpty {
                Text(snippet)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            GlobalSearchMetadataLine(
                left: GlobalSearchDate.row(date, timeZone: timeZone),
                right: metadata
            )
        }
        .padding(.vertical, 3)
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
    static func row(_ value: String?, timeZone: TimeZone?) -> String {
        guard let value else { return "" }
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

        var calendar = Calendar.current
        if let timeZone { calendar.timeZone = timeZone }
        let components = calendar.dateComponents(
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
