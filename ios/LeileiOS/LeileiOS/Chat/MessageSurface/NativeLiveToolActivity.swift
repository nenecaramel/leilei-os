import SwiftUI
import Foundation

// The same native Liquid Glass used by the iMessage composer, with dark
// content on light glass. Independent of chat bubble tints and their sliders.
private enum NativeLiveToolWallpaperStyle {
    static let primary = Color(red: 0.17, green: 0.20, blue: 0.23)
    static let secondary = Color.black.opacity(0.64)
    static let tertiary = Color.black.opacity(0.48)
}

// No glass modifier or new background is applied outside wallpaper-backed
// iMessage, so Original and plain iMessage retain their existing appearance.
private struct NativeLiveToolWallpaperGlass: ViewModifier {
    let enabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.glassEffect(
                .regular,
                in: RoundedRectangle(cornerRadius: 11, style: .continuous)
            )
        } else {
            content
        }
    }
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
                    if iMessageWallpaperVisible {
                        ProgressView()
                            .controlSize(.small)
                            .tint(NativeLiveToolWallpaperStyle.primary)
                    } else {
                        ProgressView()
                            .controlSize(.small)
                    }
                case .completed:
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )
                case .failed:
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )
                case .unknown:
                    Image(systemName: "circle")
                        .font(.system(size: 11))
                        .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )
                }

                Text(nativeLiveToolDisplayName(toolName))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.primary)
                            : AnyShapeStyle(HierarchicalShapeStyle.primary)
                    )
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.tertiary)
                            : AnyShapeStyle(HierarchicalShapeStyle.tertiary)
                    )
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            iMessageWallpaperVisible ? Color.clear : Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(NativeLiveToolWallpaperGlass(enabled: iMessageWallpaperVisible))
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
                .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )

                Text(isError ? "Tool failed" : "Tool result")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.secondary)
                            : AnyShapeStyle(HierarchicalShapeStyle.secondary)
                    )

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(
                        iMessageWallpaperVisible
                            ? AnyShapeStyle(NativeLiveToolWallpaperStyle.tertiary)
                            : AnyShapeStyle(HierarchicalShapeStyle.tertiary)
                    )
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(NativeLiveToolWallpaperGlass(enabled: iMessageWallpaperVisible))
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
