import SwiftUI

struct ComposerCircleButton: View {
    let systemName: String

    var body: some View {
        ZStack {
            Circle()
                .fill(.primary.opacity(0.055))
                .frame(width: 46, height: 46)

            Image(systemName: systemName)
                .font(.system(size: 18, weight: .medium))
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
                .fontWeight(.semibold)

            Text(effort)
                .foregroundStyle(.secondary)
        }
        .font(.system(size: 15))
        .foregroundStyle(.primary)
        .padding(.horizontal, 14)
        .frame(height: 46)
        .background(
            Capsule()
                .fill(.primary.opacity(0.055))
        )
    }
}
