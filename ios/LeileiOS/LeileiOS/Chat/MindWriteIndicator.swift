import SwiftUI

struct MindWriteIndicatorItem:
    Identifiable,
    Equatable,
    Sendable {
    let kind: String
    let count: Int

    var id: String { kind }
}

struct MindWriteIndicator: View {
    let items: [MindWriteIndicatorItem]

    var body: some View {
        if !normalizedItems.isEmpty {
            HStack(spacing: 7) {
                Text("Mind")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                ForEach(normalizedItems) { item in
                    HStack(spacing: 3) {
                        Text(item.kind)

                        if item.count > 1 {
                            Text("×\(item.count)")
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        Color.primary.opacity(0.045),
                        in: Capsule()
                    )
                }
            }
            .accessibilityElement(
                children: .combine
            )
        }
    }

    private var normalizedItems:
        [MindWriteIndicatorItem] {
        items
            .filter { item in
                !item.kind
                    .trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    .isEmpty
                    && item.count > 0
            }
            .sorted {
                $0.kind.localizedCaseInsensitiveCompare(
                    $1.kind
                ) == .orderedAscending
            }
    }
}


struct AlbumSaveIndicator: View {
    let count: Int

    var body: some View {
        if count > 0 {
            HStack(spacing: 7) {
                Text("Album")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                HStack(spacing: 3) {
                    Text("Photo")

                    if count > 1 {
                        Text("×\(count)")
                            .foregroundStyle(.tertiary)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Color.primary.opacity(0.045),
                    in: Capsule()
                )
            }
            .accessibilityElement(children: .combine)
        }
    }
}
