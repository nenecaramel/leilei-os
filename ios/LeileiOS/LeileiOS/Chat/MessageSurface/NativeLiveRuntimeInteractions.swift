import SwiftUI
import Foundation

struct NativeLiveQuestionActivityRow: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let question: NativeLiveTurnActivityProjection.QuestionActivity
    let onResolveInteraction:
        ((NativeLiveRuntimeInteractionSnapshot, [String: NativeLiveJSONValue]) async throws -> Void)?

    @State private var isShowingDetails = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                isShowingDetails = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: question.statusLabel == "Answered"
                        ? "checkmark.circle"
                        : question.statusLabel == "Cancelled" ? "xmark.circle" : "questionmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
                    Text("Asked user")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(NativeLiveActivityGlassText.primary(iMessageWallpaperVisible))
                    Spacer(minLength: 8)
                    Text(question.statusLabel)
                        .font(.caption)
                        .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(NativeLiveActivityGlassText.tertiary(iMessageWallpaperVisible))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .modifier(NativeLiveActivityGlassRow())

            if let interaction = question.interaction,
               interaction.isPending,
               let onResolveInteraction {
                NativeLiveQuestionInteractionCard(
                    interaction: interaction,
                    onResolve: onResolveInteraction
                )
            }
        }
        .padding(.horizontal, iMessageWallpaperVisible ? 0 : 5)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: "Asked user",
                status: question.statusLabel,
                sectionTitle: "Question",
                detail: question.questionDetail,
                secondarySectionTitle: "Response",
                secondaryDetail: question.responseDetail
            )
        }
    }
}

struct NativeLiveInteractionHistoryRow: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let interaction: NativeLiveRuntimeInteractionSnapshot
    var presentation: NativeLiveInteractionHistoryPresentation = .standard

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                Image(
                    systemName:
                        interaction.status == "resolved"
                            ? "checkmark.circle"
                            : (
                                interaction.status == "cancelled"
                                    ? "xmark.circle"
                                    : "exclamationmark.circle"
                            )
                )
                .font(.system(size: 12.5))
                .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))

                Text(title)
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(NativeLiveActivityGlassText.primary(iMessageWallpaperVisible))
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(statusLabel)
                    .font(.caption)
                    .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(NativeLiveActivityGlassText.tertiary(iMessageWallpaperVisible))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, iMessageWallpaperVisible ? 0 : 5)
        .modifier(NativeLiveActivityGlassRow())
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: title,
                status: statusLabel,
                sectionTitle: "Request",
                detail: nativeLiveJSONDetail(
                    .object(interaction.request)
                ),
                secondarySectionTitle:
                    interaction.response == nil
                        ? nil
                        : "Response",
                secondaryDetail:
                    interaction.response.flatMap {
                        nativeLiveJSONDetail(.object($0))
                    }
            )
        }
    }

    private var title: String {
        presentation.title(for: interaction)
    }

    private var statusLabel: String {
        presentation.statusLabel(for: interaction)
    }
}
