import SwiftUI

struct ComposerCircleButton: View {
    let systemName: String

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(uiColor: .tertiarySystemFill))
                .frame(width: 36, height: 36)

            Image(systemName: systemName)
                .font(.system(
                    size: 15,
                    weight: .medium
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
                .fontWeight(.medium)

            Text(effort)
                .foregroundStyle(.primary.opacity(0.80))
        }
        .font(.system(size: 13))
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .frame(height: 36)
        .background(
            Capsule()
                .fill(Color(uiColor: .tertiarySystemFill))
        )
    }
}
