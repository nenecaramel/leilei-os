import SwiftUI

struct NativeLiveDiffRenderer: View {
    let model: NativeLiveDiffPresentation
    var body: some View {
        NativeLiveSourcePanel(label: "Diff", copyText: model.rawSource) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(model.lines.indices, id: \.self) { index in
                    let line = model.lines[index]
                    Text(line.text.isEmpty ? " " : line.text).font(.system(size: 14, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(color(line.kind).opacity(0.12))
                        .accessibilityLabel(line.accessibilityText)
                }
            }
        }
    }
    private func color(_ kind: NativeLiveDiffPresentation.Kind) -> Color {
        switch kind {
        case .added: return .green
        case .removed: return .red
        case .hunk: return .blue
        case .header: return .secondary
        case .context: return .clear
        }
    }
}
