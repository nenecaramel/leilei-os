import SwiftUI

struct NativeLiveMathRenderer: View {
    let model: NativeLiveMathPresentation
    var body: some View {
        NativeLiveSourcePanel(label: model.isDisplay ? "Math · LaTeX source" : "Inline math · LaTeX source", copyText: model.latex) {
            Text(model.latex).font(.system(size: 15, design: .monospaced))
                .accessibilityLabel("Math: \(model.latex)")
        }.accessibilityHint("LaTeX source fallback")
    }
}
