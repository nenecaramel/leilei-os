import SwiftUI

extension Color {
    static var chatSoftFill: Color {
        LeileiUI.Color.softFill
    }
}

struct ComposerCircleButton: View {
    let systemName: String
    var weight: Font.Weight = .medium

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.chatSoftFill)
                .frame(width: LeileiUI.ControlGeometry.compact, height: LeileiUI.ControlGeometry.compact)

            Image(systemName: systemName)
                .font(LeileiUI.Typography.controlGlyph(weight: weight))
                .foregroundStyle(.primary)
        }
    }
}

struct CombinedModelCapsule: View {
    let model: String
    let effort: String

    var body: some View {
        HStack(spacing: 5) {
            Text(model)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(.primary)

            Text(effort)
                .font(.system(size: 11.5, weight: .regular))
                .foregroundStyle(.primary.opacity(0.55))
        }
        .padding(.horizontal, 10)
        .frame(height: LeileiUI.ControlGeometry.compact)
        .background(
            Capsule()
                .fill(Color.chatSoftFill)
        )
    }
}
