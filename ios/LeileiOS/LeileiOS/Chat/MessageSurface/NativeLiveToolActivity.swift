import SwiftUI
import Foundation

// The wallpaper is visible beneath iMessage tool activity, independently
// of the user/assistant text-bubble tint and its opacity slider.
private enum NativeLiveToolWallpaperStyle {
    static let background = Color(red: 0.21, green: 0.25, blue: 0.28).opacity(0.94)
    static let secondary = Color.white.opacity(0.78)
    static let tertiary = Color.white.opacity(0.65)
}

struct NativeLiveToolActivityRow: View {
    let tool: NativeLiveTurnActivityProjection.ToolActivity
    let permissionInteractions:
        [NativeLiveRuntimeInteractionSnapshot]
    let onResolveInteraction:
        ((
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            NativeLiveToolCallCard(
                toolName: tool.toolName,
                detail: nativeLiveJSONDetail(tool.input),
                resultDetail: nativeLiveJSONDetail(tool.output),
                resourceDetail:
                    tool.resourceLinks.isEmpty
                        ? nil
                        : nativeLiveJSONDetail(
                            .array(tool.resourceLinks)
                        ),
                state: tool.state
            )

            ForEach(permissionInteractions) { interaction in
                if interaction.isPending,
                   let onResolveInteraction {
                    NativeLivePermissionInteractionCard(
                        interaction: interaction,
                        onResolve: onResolveInteraction
                    )
                    .padding(.leading, 18)
                } else {
                    NativeLiveInteractionHistoryRow(
                        interaction: interaction,
                        presentation: .nestedPermission
                    )
                    .padding(.leading, 18)
                }
            }
        }
    }
}

enum NativeLiveToolCallState: Equatable {
    case running
    case completed
    case failed
    case unknown
}

struct NativeLiveToolCallCard: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let toolName: String
    let detail: String?
    var resultDetail: String? = nil
    var resourceDetail: String? = nil
    let state: NativeLiveToolCallState

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                switch state {
                case .running:
                    ProgressView()
                        .controlSize(.small)
                        .tint(iMessageWallpaperVisible ? .white : .primary)
                case .completed:
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)
                case .failed:
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)
                case .unknown:
                    Image(systemName: "circle")
                        .font(.system(size: 11))
                        .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)
                }

                Text(nativeLiveToolDisplayName(toolName))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(iMessageWallpaperVisible ? Color.white : Color.primary)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.tertiary : Color(.tertiaryLabel))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            iMessageWallpaperVisible
                ? NativeLiveToolWallpaperStyle.background
                : Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: nativeLiveToolDisplayName(toolName),
                status: stateLabel,
                sectionTitle: "Input",
                detail: detail,
                secondarySectionTitle:
                    resultDetail == nil ? nil : "Output",
                secondaryDetail: resultDetail,
                tertiarySectionTitle:
                    resourceDetail == nil ? nil : "Resources",
                tertiaryDetail: resourceDetail
            )
        }
    }

    private var stateLabel: String {
        switch state {
        case .running:
            return "Running"
        case .completed:
            return "Done"
        case .failed:
            return "Failed"
        case .unknown:
            return "No result"
        }
    }
}

struct NativeLiveToolResultCard: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let isError: Bool
    let detail: String?

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                Image(
                    systemName:
                        isError
                        ? "exclamationmark.circle"
                        : "checkmark.circle"
                )
                .font(.system(size: 13))
                .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)

                Text(isError ? "Tool failed" : "Tool result")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.secondary : Color.secondary)

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(iMessageWallpaperVisible ? NativeLiveToolWallpaperStyle.tertiary : Color(.tertiaryLabel))
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if iMessageWallpaperVisible {
                // Result rows had no fill at all; paint behind the row
                // without changing its size, vertical spacing, or actions.
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(NativeLiveToolWallpaperStyle.background)
                    .padding(.vertical, -3)
                    .allowsHitTesting(false)
            }
        }
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: isError ? "Tool failed" : "Tool result",
                status: isError ? "Failed" : "Done",
                sectionTitle: "Output",
                detail: detail
            )
        }
    }
}
