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
