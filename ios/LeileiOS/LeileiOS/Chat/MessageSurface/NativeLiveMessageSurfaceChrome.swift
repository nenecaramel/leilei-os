import SwiftUI

// Display-only payloads. Visibility, actions and transitions stay in the surface.
struct NativeLiveCopyFeedbackBanner: View {
    let text: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark")
                .font(.system(
                    size: 12,
                    weight: .semibold
                ))

            Text(text)
                .font(.system(
                    size: 14,
                    weight: .regular
                ))

            Spacer(minLength: 0)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 14)
        .frame(
            maxWidth: .infinity,
            minHeight: 40
        )
        .glassEffect(
            .regular,
            in: RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
            .stroke(
                Color.primary.opacity(0.08),
                lineWidth: 0.6
            )
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }
}

struct NativeLiveReturnToBottomGlyph: View {

    var body: some View {
        Image(systemName: "arrow.down")
            .font(.system(
                size: 16,
                weight: .light
            ))
            .foregroundStyle(
                Color.primary.opacity(0.78)
            )
            .frame(width: ChatPresentationLayout.scrollActionDiameter, height: ChatPresentationLayout.scrollActionDiameter)
            .glassEffect(
                .regular,
                in: Circle()
            )
            .overlay {
                Circle()
                    .stroke(
                        Color.primary.opacity(0.08),
                        lineWidth: 0.6
                    )
            }
    }
}

struct NativeLivePaginationLabel: View {
    let isLoadingOlderMessages: Bool
    var body: some View {
        HStack(spacing: 8) {
            if isLoadingOlderMessages {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "chevron.up")
                    .font(.system(size: 12, weight: .semibold))
            }

            Text(
                isLoadingOlderMessages
                    ? "Loading…"
                    : "还有更早消息"
            )
            .font(.footnote.weight(.medium))
        }
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
}
