import SwiftUI
import UIKit

// Match the native regular glass used by Tool rows and the iMessage input.
// Original and chats without a wallpaper retain each renderer's old fill.
struct NativeLiveIMessageContentPanel: ViewModifier {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let originalOpacity: Double
    let originalCornerRadius: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if iMessageWallpaperVisible {
            content
                .foregroundStyle(Color(red: 0.17, green: 0.20, blue: 0.23))
                .glassEffect(
                    .regular,
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                )
        } else if originalOpacity > 0 {
            content.background(
                Color.primary.opacity(originalOpacity),
                in: RoundedRectangle(cornerRadius: originalCornerRadius)
            )
        } else {
            content
        }
    }
}

// All source surfaces share bounded native scrolling and independent copy semantics.
struct NativeLiveSourcePanel<Content: View>: View {
    let label: String
    let copyText: String
    @ViewBuilder let content: Content
    @Environment(\.nativeLiveCopyFeedback) private var copyFeedback
    @State private var isCopied = false
    @State private var copyGeneration = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { copy() } label: {
                    Image(
                        systemName:
                            isCopied
                                ? "checkmark"
                                : "square.on.square"
                    )
                    .font(.system(size: 15))
                    .frame(width: 24, height: 24)
                }
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
                .accessibilityLabel(isCopied ? "Copied" : "Copy \(label)")
            }
            ScrollView([.horizontal, .vertical]) {
                content.fixedSize(horizontal: true, vertical: true)
                    .textSelection(.enabled).padding(.bottom, 3)
            }.frame(maxHeight: 360)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.055,
            originalCornerRadius: 10
        ))
    }

    private func copy() {
        UIPasteboard.general.string = copyText
        copyFeedback("Copied")
        copyGeneration += 1
        let generation = copyGeneration
        withAnimation(LeileiUI.Motion.feedback) {
            isCopied = true
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard copyGeneration == generation else { return }
            withAnimation(LeileiUI.Motion.feedback) {
                isCopied = false
            }
        }
    }
}
struct NativeLiveCodeRenderer: View {
    let model: NativeLiveCodePresentation
    var body: some View {
        NativeLiveSourcePanel(label: model.language.map { "Code · \($0)" } ?? "Code", copyText: model.code) {
            Text(model.code).font(.system(size: 14, design: .monospaced))
        }
        .accessibilityHint(model.closed ? "Code source" : "Streaming or unclosed code fence")
    }
}
struct NativeLiveMermaidSourceRenderer: View {
    let model: NativeLiveCodePresentation
    var body: some View {
        NativeLiveSourcePanel(label: "Mermaid source preview", copyText: model.code) {
            Text(model.code).font(.system(size: 14, design: .monospaced))
        }.accessibilityHint("Diagram rendering is not available")
    }
}
