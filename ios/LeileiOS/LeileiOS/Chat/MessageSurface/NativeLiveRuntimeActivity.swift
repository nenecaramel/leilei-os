import SwiftUI
import Foundation

struct NativeLiveRuntimeAssistantRow: View {
    let runtimeSurface: NativeLiveRuntimeSurfaceState?
    let onResolveInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    var body: some View {
        let text = runtimeSurface?.streamingText
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        let projection = runtimeSurface.map {
            NativeLiveTurnActivityProjection(
                runtimeSurface: $0
            )
        }

        VStack(alignment: .leading, spacing: 12) {
            if let text,
               !text.isEmpty {
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: true,
                    lineSpacing: 6,
                    paragraphSpacing: 22
                )
            }

            if let projection,
               projection.hasContent {
                NativeLiveTurnActivityView(
                    projection: projection,
                    onResolveInteraction: onResolveInteraction
                )
            }

            if (text?.isEmpty ?? true)
                && !(projection?.hasContent ?? false) {
                AssistantTypingIndicatorRow()
            }
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
    }
}

struct NativeLiveTurnActivityView: View {
    let projection: NativeLiveTurnActivityProjection
    let onResolveInteraction:
        ((
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void)?

    @State private var isExpanded = false
    @State private var expandedForPendingInteraction = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                if projection.hasPendingInteraction {
                    isExpanded = true
                } else {
                    isExpanded.toggle()
                    expandedForPendingInteraction = false
                }
            } label: {
                HStack(spacing: 8) {
                    Text(projection.summaryLabel)
                        .font(.system(
                            size: 13.5,
                            weight: .medium
                        ))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    Image(
                        systemName:
                            effectiveExpanded
                                ? "chevron.down"
                                : "chevron.right"
                    )
                    .font(.system(
                        size: 10,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if effectiveExpanded {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(projection.lifecycle) { lifecycle in
                        NativeLiveLifecycleActivityRow(
                            lifecycle: lifecycle
                        )
                    }

                    ForEach(projection.tasks) { task in
                        NativeLiveTaskActivityRow(
                            task: task,
                            childTools:
                                projection.childTools(for: task),
                            permissionInteractions: { tool in
                                projection.permissionInteractions(
                                    for: tool
                                )
                            },
                            turnIsActive: projection.turnIsActive,
                            onResolveInteraction: onResolveInteraction
                        )
                    }

                    ForEach(projection.topLevelTools) { tool in
                        NativeLiveToolActivityRow(
                            tool: tool,
                            permissionInteractions:
                                projection.permissionInteractions(
                                    for: tool
                                ),
                            onResolveInteraction: onResolveInteraction
                        )
                    }

                    ForEach(projection.topLevelInteractions) { interaction in
                        if interaction.isPending,
                           let onResolveInteraction {
                            switch interaction.kind {
                            case "permission":
                                NativeLivePermissionInteractionCard(
                                    interaction: interaction,
                                    onResolve: onResolveInteraction
                                )
                            case "question":
                                NativeLiveQuestionInteractionCard(
                                    interaction: interaction,
                                    onResolve: onResolveInteraction
                                )
                            default:
                                NativeLiveInteractionHistoryRow(
                                    interaction: interaction
                                )
                            }
                        } else {
                            NativeLiveInteractionHistoryRow(
                                interaction: interaction
                            )
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
        .onAppear {
            if projection.hasPendingInteraction,
               !isExpanded {
                isExpanded = true
                expandedForPendingInteraction = true
            }
        }
        .onChange(
            of: projection.pendingInteractionIDs
        ) { _, ids in
            if !ids.isEmpty {
                if !isExpanded {
                    isExpanded = true
                    expandedForPendingInteraction = true
                }
            } else if expandedForPendingInteraction {
                isExpanded = false
                expandedForPendingInteraction = false
            }
        }
    }

    private var effectiveExpanded: Bool {
        isExpanded || projection.hasPendingInteraction
    }
}

private struct NativeLiveLifecycleActivityRow: View {
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

private struct NativeLiveTaskActivityRow: View {
    let task: NativeLiveTurnActivityProjection.TaskActivity
    let childTools:
        [NativeLiveTurnActivityProjection.ToolActivity]
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

private struct NativeLiveTaskResourceRow: View {
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

private struct NativeLiveToolActivityRow: View {
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
                        interaction: interaction
                    )
                    .padding(.leading, 18)
                }
            }
        }
    }
}

private struct NativeLiveInteractionHistoryRow: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot

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
                .foregroundStyle(.secondary)

                Text(title)
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(interaction.status.capitalized)
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
        .padding(.horizontal, 5)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: title,
                status: interaction.status.capitalized,
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
        if interaction.kind == "permission" {
            return interaction.permissionTitle
        }
        if let question = interaction.questions.first {
            return question.header ?? question.text
        }
        return interaction.kind.capitalized
    }
}


struct AssistantTypingIndicatorRow: View {
    var body: some View {
        TimelineView(
            .animation(minimumInterval: 0.18)
        ) { context in
            let phase = Int(
                context.date.timeIntervalSinceReferenceDate / 0.18
            ) % 3

            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(
                            Color.secondary.opacity(
                                phase == index ? 0.82 : 0.24
                            )
                        )
                        .frame(width: 5, height: 5)
                        .scaleEffect(
                            phase == index ? 1.08 : 0.92
                        )
                }
            }
            .frame(height: 22)
            .frame(maxWidth: .infinity, alignment: .leading)
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
                case .completed:
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                case .failed:
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                case .unknown:
                    Image(systemName: "circle")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Text(nativeLiveToolDisplayName(toolName))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(stateLabel)
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
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            Color.primary.opacity(0.045),
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
                .foregroundStyle(.secondary)

                Text(isError ? "Tool failed" : "Tool result")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 8)

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
        .padding(.leading, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
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


private struct NativeLiveToolDetailSheet: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let status: String
    let sectionTitle: String
    let detail: String?
    var secondarySectionTitle: String? = nil
    var secondaryDetail: String? = nil
    var tertiarySectionTitle: String? = nil
    var tertiaryDetail: String? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text(status)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Spacer()
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text(sectionTitle)
                            .font(.headline)

                        if let detail,
                           !detail.isEmpty {
                            Text(detail)
                                .font(.system(
                                    size: 13,
                                    design: .monospaced
                                ))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .fixedSize(
                                    horizontal: false,
                                    vertical: true
                                )
                                .frame(
                                    maxWidth: .infinity,
                                    alignment: .leading
                                )
                        } else {
                            Text("No details")
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let secondarySectionTitle,
                       let secondaryDetail,
                       !secondaryDetail.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(secondarySectionTitle)
                                .font(.headline)

                            Text(secondaryDetail)
                                .font(.system(
                                    size: 13,
                                    design: .monospaced
                                ))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .fixedSize(
                                    horizontal: false,
                                    vertical: true
                                )
                                .frame(
                                    maxWidth: .infinity,
                                    alignment: .leading
                                )
                        }
                    }

                    if let tertiarySectionTitle,
                       let tertiaryDetail,
                       !tertiaryDetail.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(tertiarySectionTitle)
                                .font(.headline)

                            Text(tertiaryDetail)
                                .font(.system(
                                    size: 13,
                                    design: .monospaced
                                ))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .fixedSize(
                                    horizontal: false,
                                    vertical: true
                                )
                                .frame(
                                    maxWidth: .infinity,
                                    alignment: .leading
                                )
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
            .background(Color(.systemBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([
            .medium,
            .large
        ])
        .presentationDragIndicator(.visible)
        .presentationBackground(
            Color(.systemBackground)
        )
    }
}


func nativeLiveToolDisplayName(
    _ raw: String
) -> String {
    let prefix = "mcp__leileios__"
    guard raw.hasPrefix(prefix) else {
        return raw
    }
    return "LeileiOS · " + String(raw.dropFirst(prefix.count))
}


func nativeLiveJSONDetail(
    _ value: NativeLiveJSONValue?
) -> String? {
    guard let value else { return nil }
    let rendered = nativeLiveJSONDescription(value)
    let normalized = rendered.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}


private func nativeLiveJSONDescription(
    _ value: NativeLiveJSONValue
) -> String {
    switch value {
    case .string(let string):
        return string
    case .number(let number):
        return String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    case .null:
        return "null"
    case .array(let values):
        return "["
            + values.map(nativeLiveJSONDescription)
                .joined(separator: ", ")
            + "]"
    case .object(let object):
        return "{"
            + object.keys.sorted().map { key in
                let value = object[key] ?? .null
                return key
                    + ": "
                    + nativeLiveJSONDescription(value)
            }
            .joined(separator: ", ")
            + "}"
    }
}
