import SwiftUI

struct NativeLiveVisibleThinkingSurface: View {
    let items: [NativeLiveVisibleThinkingItem]

    @State private var isExpanded = false

    var body: some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Button { isExpanded.toggle() } label: {
                    HStack(spacing: 12) {
                        Text("Thought process")
                            .font(.system(size: 14))
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 14))
                            .frame(height: 22)
                        Spacer(minLength: 8)
                    }
                    .foregroundStyle(.secondary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isExpanded ? "Collapse thought process" : "Expand thought process")
                .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
                if isExpanded {
                    ForEach(items) { item in
                        Text(item.text)
                            .font(.system(size: 14))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }
}
