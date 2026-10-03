import SwiftUI

struct NativeLiveTableRenderer: View {
    let model: NativeLiveTablePresentation
    var body: some View {
        NativeLiveSourcePanel(label: "Table", copyText: model.rawSource) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(model.cells.indices, id: \.self) { row in
                    GridRow {
                        ForEach(model.headers.indices, id: \.self) { column in
                            Text(model.cells[row][column])
                                .font(.system(size: 15, weight: row == 0 ? .semibold : .regular))
                                .frame(width: model.columnWidth, alignment: alignment(column))
                                .padding(8).background(Color.primary.opacity(row == 0 ? 0.08 : 0.025))
                                .accessibilityLabel("\(model.headers[column]): \(row == 0 ? model.headers[column] : model.rows[row-1][column])")
                        }
                    }
                }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            NativeLiveLinkCapability.openableURL(url.absoluteString) == nil ? .discarded : .systemAction
        })
    }
    private func alignment(_ column: Int) -> Alignment {
        switch model.alignments[column] {
        case .leading: return .leading
        case .center: return .center
        case .trailing: return .trailing
        }
    }
}
