import SwiftUI

extension Color {
    static var chatSoftFill: Color {
        Color(uiColor: .quaternarySystemFill)
    }
}

struct ComposerCircleButton: View {
    let systemName: String
    var weight: Font.Weight = .medium

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.chatSoftFill)
                .frame(width: 36, height: 36)

            Image(systemName: systemName)
                .font(.system(
                    size: 15,
                    weight: weight
                ))
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
        .frame(height: 36)
        .background(
            Capsule()
                .fill(Color.chatSoftFill)
        )
    }
}
