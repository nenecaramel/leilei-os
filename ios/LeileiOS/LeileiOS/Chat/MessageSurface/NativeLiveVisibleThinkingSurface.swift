import SwiftUI

struct NativeLiveVisibleThinkingSurface: View {
    let items: [NativeLiveVisibleThinkingItem]

    @State private var isShowingThoughtProcess = false

    var body: some View {
        if !items.isEmpty {
            Button { isShowingThoughtProcess = true } label: {
                HStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.system(size: 14, weight: .light))
                    Text("Thought process")
                        .font(.system(size: 14))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .light))
                        .frame(height: 22)
                    Spacer(minLength: 8)
                }
                .foregroundStyle(.secondary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Thought process")
            .sheet(isPresented: $isShowingThoughtProcess) {
                NativeLiveThoughtProcessSheet(items: items)
            }
        }
    }
}

private struct NativeLiveThoughtProcessSheet: View {
    let items: [NativeLiveVisibleThinkingItem]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(items) { item in
                        Text(item.text)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .navigationTitle("Thought process")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
