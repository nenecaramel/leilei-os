import SwiftUI
import UIKit

// All source surfaces share bounded native scrolling and independent copy semantics.
struct NativeLiveSourcePanel<Content: View>: View {
    let label: String
    let copyText: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button { UIPasteboard.general.string = copyText } label: { Image(systemName: "doc.on.doc") }
                    .buttonStyle(.plain).accessibilityLabel("Copy \(label)")
            }
            ScrollView([.horizontal, .vertical]) {
                content.fixedSize(horizontal: true, vertical: true)
                    .textSelection(.enabled).padding(.bottom, 3)
            }.frame(maxHeight: 360)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 10))
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
