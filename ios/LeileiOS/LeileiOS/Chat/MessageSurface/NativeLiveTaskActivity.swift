import SwiftUI
import Foundation

struct NativeLiveLifecycleActivityRow: View {
    let lifecycle:
        NativeLiveTurnActivityProjection.LifecycleActivity

    var body: some View {
        HStack(spacing: 8) {
            if lifecycle.kind == "api_retry" {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: "clock")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
            }

            Text(lifecycle.title)
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer(minLength: 8)

            if let detail = lifecycle.detail,
               !detail.isEmpty {
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 5)
    }
}

struct NativeLiveTaskActivityRow: View {
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
                        .foregroundStyle(.primary)
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
                    .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }

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
                .foregroundStyle(.secondary)
        } else if task.isCancelled {
            Image(systemName: "xmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
        } else if task.isTerminal {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
        } else if task.isCurrentlyActive,
                  turnIsActive
                    || task.isBackgrounded == true {
            ProgressView()
                .controlSize(.mini)
        } else {
            Image(systemName: "circle")
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
        }
    }
}

struct NativeLiveTaskResourceRow: View {
    let task: NativeLiveTurnActivityProjection.TaskActivity

    @State private var isShowingResources = false

    var body: some View {
        Button {
            isShowingResources = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "link")
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)

                Text("Resources")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(.primary)

                Spacer(minLength: 8)

                Text(String(task.resourceLinks.count))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
