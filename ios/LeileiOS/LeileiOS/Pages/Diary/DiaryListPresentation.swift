import SwiftUI
import UIKit

struct DiaryNavigationTitle: View {
    let title: String
    let count: Int?

    var body: some View {
        if let count {
            HStack(spacing: 6) {
                Text("\(count)")
                    .font(.system(size: 12, weight: .regular))
                    .hidden()

                Text(title)
                    .font(.headline)

                Text("\(count)")
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(.secondary)
            }
            .fixedSize()
        } else {
            Text(title)
                .font(.headline)
        }
    }
}

struct DiaryListSkeleton: View {
    var body: some View {
        List {
            ForEach(0..<5, id: \.self) { index in
                VStack(alignment: .leading, spacing: 5) {
                    Text(index.isMultiple(of: 2) ? "Diary entry title" : "Another diary title")
                        .font(.body.weight(.semibold))

                    Text(index.isMultiple(of: 2) ? "Entry metadata" : "Diary metadata")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .redacted(reason: .placeholder)
                .listRowBackground(Color(.systemBackground))
                .padding(.vertical, 2)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct DiaryList: View {
    let diaries: [DiaryEntry]
    let onChanged: () -> Void

    var body: some View {
        List {
            ForEach(DiaryMonthGroup.make(from: diaries)) { group in
                Section(group.title) {
                    ForEach(Array(group.diaries.enumerated()), id: \.element.id) { index, diary in
                        NavigationLink {
                            DiaryDetailView(
                                diaryID: diary.id,
                                onChanged: onChanged
                            )
                        } label: {
                            DiaryRow(diary: diary)
                        }
                        .listRowBackground(Color(.systemBackground))
                        .listRowSeparator(index == 0 ? .hidden : .visible, edges: .top)
                        .listRowSeparator(
                            index == group.diaries.count - 1 ? .hidden : .visible,
                            edges: .bottom
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

struct DiaryRow: View {
    let diary: DiaryEntry

    private var metadataText: String {
        var parts: [String] = []

        if let mood = diary.mood?.trimmingCharacters(in: .whitespacesAndNewlines),
           !mood.isEmpty {
            parts.append(mood)
        }

        if !diary.tags.isEmpty {
            parts.append(diary.tags.map { "#\($0)" }.joined(separator: " "))
        }

        return parts.joined(separator: "  ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(diary.title)
                .font(.body.weight(.semibold))
                .lineLimit(1)

            HStack(spacing: 12) {
                Text(DiaryDate.formatRow(diary.date))
                    .fixedSize(horizontal: true, vertical: false)

                Spacer(minLength: 8)

                if !metadataText.isEmpty {
                    Text(metadataText)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}
