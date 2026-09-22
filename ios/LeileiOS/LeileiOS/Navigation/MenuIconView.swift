import SwiftUI

struct MenuIconView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            line(width: 18)
            line(width: 18)
            line(width: 12)
        }
        .frame(width: 44, height: 44, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityLabel("Menu")
    }

    private func line(width: CGFloat) -> some View {
        Capsule()
            .fill(Color.primary)
            .frame(width: width, height: 2)
    }
}
