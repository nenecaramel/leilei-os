import SwiftUI
import Foundation

// Compact Tool-list glass for task headings and status/history sub-rows.
// No visual changes without an iMessage wallpaper; child cards remain separate.
enum NativeLiveActivityGlassText {
    static let primaryColor = Color(red: 0.17, green: 0.20, blue: 0.23)

    static func primary(_ enabled: Bool) -> AnyShapeStyle {
        enabled ? AnyShapeStyle(primaryColor) : AnyShapeStyle(HierarchicalShapeStyle.primary)
    }

    static func secondary(_ enabled: Bool) -> AnyShapeStyle {
        enabled ? AnyShapeStyle(Color.black.opacity(0.64)) : AnyShapeStyle(HierarchicalShapeStyle.secondary)
    }

    static func tertiary(_ enabled: Bool) -> AnyShapeStyle {
        enabled ? AnyShapeStyle(Color.black.opacity(0.48)) : AnyShapeStyle(HierarchicalShapeStyle.tertiary)
    }
}

struct NativeLiveActivityGlassRow: ViewModifier {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible

    @ViewBuilder
    func body(content: Content) -> some View {
        if iMessageWallpaperVisible {
            content
                .padding(.horizontal, 11)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassEffect(
                    .regular,
                    in: RoundedRectangle(cornerRadius: 11, style: .continuous)
                )
        } else {
            content
        }
    }
}

struct NativeLiveLifecycleActivityRow: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let lifecycle:
        NativeLiveTurnActivityProjection.LifecycleActivity

    var body: some View {
        HStack(spacing: 8) {
            if lifecycle.kind == "api_retry" {
                if iMessageWallpaperVisible {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(NativeLiveActivityGlassText.primaryColor)
                } else {
                    ProgressView()
                        .controlSize(.mini)
                }
            } else {
                Image(systemName: "clock")
                    .font(.system(size: 12.5))
                    .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
            }

            Text(lifecycle.title)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(NativeLiveActivityGlassText.primary(iMessageWallpaperVisible))
                .lineLimit(1)

            Spacer(minLength: 8)

            if let detail = lifecycle.detail,
               !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
            }
        }
        .padding(.horizontal, iMessageWallpaperVisible ? 0 : 5)
        .modifier(NativeLiveActivityGlassRow())
    }
}

struct NativeLiveTaskActivityRow: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let task: NativeLiveTurnActivityProjection.TaskActivity
    let childTools:
        [NativeLiveTurnActivityProjection.ToolActivity]
    let childQuestions:
        [NativeLiveTurnActivityProjection.QuestionActivity]
    let permissionInteractions:
        (NativeLiveTurnActivityProjection.ToolActivity)
            -> [NativeLiveRuntimeInteractionSnapshot]
    let turnIsActive: Bool
    let onResolveInteraction:
        ((
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                taskIcon
                    .frame(width: 15, height: 18)

                VStack(alignment: .leading, spacing: 3) {
                    Text(task.displayTitle)
                        .font(.system(
                            size: 13.5,
                            weight: .medium
                        ))
                        .foregroundStyle(NativeLiveActivityGlassText.primary(iMessageWallpaperVisible))
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        if let subagentType = task.subagentType,
                           !subagentType.isEmpty {
                            Text(subagentType)
                        }

                        if task.isBackgrounded == true {
                            Text("Background")
                        }

                        if let status = task.status,
                           !status.isEmpty {
                            Text(status.capitalized)
                        } else if let phase = task.phase,
                                  !phase.isEmpty {
                            Text(phase.replacingOccurrences(
                                of: "_",
                                with: " "
                            ).capitalized)
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
                }

                Spacer(minLength: 0)
            }
            // Only the task header gets glass. Nested Tool, Question and
            // Resources keep their own independent surfaces and tap targets.
            .modifier(NativeLiveActivityGlassRow())

            ForEach(childTools) { tool in
                NativeLiveToolActivityRow(
                    tool: tool,
                    permissionInteractions:
                        permissionInteractions(tool),
                    onResolveInteraction: onResolveInteraction
                )
                .padding(.leading, 23)
            }

            ForEach(childQuestions) { question in
                NativeLiveQuestionActivityRow(
                    question: question,
                    onResolveInteraction: onResolveInteraction
                )
                .padding(.leading, 23)
            }

            if !task.resourceLinks.isEmpty {
                NativeLiveTaskResourceRow(
                    task: task
                )
                .padding(.leading, 23)
            }
        }
        .padding(.leading, CGFloat(
            min(max(task.spawnDepth ?? 0, 0), 4)
        ) * 10)
    }

    @ViewBuilder
    private var taskIcon: some View {
        if task.isFailed {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
        } else if task.isCancelled {
            Image(systemName: "xmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
        } else if task.isTerminal {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
        } else if task.isCurrentlyActive,
                  turnIsActive
                    || task.isBackgrounded == true {
            if iMessageWallpaperVisible {
                ProgressView()
                    .controlSize(.mini)
                    .tint(NativeLiveActivityGlassText.primaryColor)
            } else {
                ProgressView()
                    .controlSize(.mini)
            }
        } else {
            Image(systemName: "circle")
                .font(.system(size: 10.5))
                .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))
        }
    }
}

struct NativeLiveTaskResourceRow: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let task: NativeLiveTurnActivityProjection.TaskActivity

    @State private var isShowingResources = false

    var body: some View {
        Button {
            isShowingResources = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 12.5))
                    .foregroundStyle(NativeLiveActivityGlassText.secondary(iMessageWallpaperVisible))

                Text("Resources")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(NativeLiveActivityGlassText.primary(iMessageWallpaperVisible))

                Spacer(minLength: 8)

                Text(String(task.resourceLinks.count))
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
        .modifier(NativeLiveActivityGlassRow())
        .sheet(isPresented: $isShowingResources) {
            NativeLiveToolDetailSheet(
                title: task.displayTitle,
                status:
                    task.status?.capitalized
                    ?? task.phase?.replacingOccurrences(
                        of: "_",
                        with: " "
                    ).capitalized
                    ?? "Task",
                sectionTitle: "Resources",
                detail: nativeLiveJSONDetail(
                    .array(task.resourceLinks)
                )
            )
        }
    }
}
