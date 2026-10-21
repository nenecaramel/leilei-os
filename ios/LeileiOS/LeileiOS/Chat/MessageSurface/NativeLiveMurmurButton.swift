import SwiftUI

// The murmur bubble on the Thought process row; Worked for draws its own.
struct NativeLiveMurmurButton: View {
    let text: String?

    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    @State private var isShowingMurmur = false

    var body: some View {
        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            Button {
                isShowingMurmur = true
            } label: {
                Image(systemName: "bubble.left")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.secondary)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Murmur")
            .sheet(isPresented: $isShowingMurmur) {
                NativeLiveMurmurSheet(text: text)
            }
        }
    }
}
