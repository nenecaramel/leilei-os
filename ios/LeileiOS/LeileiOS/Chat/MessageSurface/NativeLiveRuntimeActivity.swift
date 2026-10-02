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

struct NativeLiveTurnActivityProjection: Equatable {
    struct ToolActivity: Equatable, Identifiable {
        let id: String
        let toolName: String
        let input: NativeLiveJSONValue?
        let output: NativeLiveJSONValue?
        let state: NativeLiveToolCallState
        let order: Int
    }

    struct TaskActivity: Equatable, Identifiable {
        let id: String
        var toolUseID: String?
        var description: String?
        var summary: String?
        var subagentType: String?
        var taskType: String?
        var isBackgrounded: Bool?
        var spawnDepth: Int?
        var phase: String?
        var status: String?
        var order: Int

        var displayTitle: String {
            if let summary = normalized(summary) {
                return summary
            }
            if let description = normalized(description) {
                return description
            }
            if let subagentType = normalized(subagentType) {
                return subagentType
            }
            if let taskType = normalized(taskType) {
                return taskType
            }
            return "Task"
        }

        var isTerminal: Bool {
            guard let status else { return false }
            return [
                "completed",
                "failed",
                "cancelled",
            ].contains(status)
        }

        var isFailed: Bool {
            status == "failed"
        }

        private func normalized(_ value: String?) -> String? {
            guard let value else { return nil }
            let trimmed = value.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    let prepareID: String?
    let tools: [ToolActivity]
    let tasks: [TaskActivity]
    let interactions: [NativeLiveRuntimeInteractionSnapshot]
    let turnIsActive: Bool

    var hasContent: Bool {
        !tools.isEmpty
            || !tasks.isEmpty
            || !interactions.isEmpty
    }

    var pendingInteractions: [NativeLiveRuntimeInteractionSnapshot] {
        interactions.filter(\.isPending)
    }

    var hasPendingInteraction: Bool {
        !pendingInteractions.isEmpty
    }

    var pendingInteractionIDs: [String] {
        pendingInteractions.map(\.interactionID)
    }

    var hasFailure: Bool {
        tools.contains { $0.state == .failed }
            || tasks.contains(\.isFailed)
    }

    var activityCount: Int {
        tools.count + tasks.count + interactions.count
    }

    var headerTitle: String {
        if let pending = pendingInteractions.first {
            if pending.kind == "permission" {
                return pending.permissionTitle
            }
            if let question = pending.questions.first {
                return question.header ?? question.text
            }
        }

        if let task = tasks
            .filter({ !$0.isTerminal })
            .sorted(by: { $0.order < $1.order })
            .last {
            return task.displayTitle
        }

        if turnIsActive,
           let tool = tools
            .filter({ $0.state == .running })
            .sorted(by: { $0.order < $1.order })
            .last {
            return nativeLiveToolDisplayName(tool.toolName)
        }

        if let task = tasks.sorted(by: { $0.order < $1.order }).last {
            return task.displayTitle
        }

        return "Activity"
    }

    var stateLabel: String {
        if hasPendingInteraction {
            return "Needs input"
        }
        if hasFailure {
            return "Failed"
        }
        if turnIsActive {
            return "Running"
        }
        return "Done"
    }

    init(runtimeSurface: NativeLiveRuntimeSurfaceState) {
        prepareID = runtimeSurface.prepareID
        tools = Self.tools(from: runtimeSurface.events)
        tasks = Self.tasks(from: runtimeSurface.events)
        interactions = runtimeSurface.interactions
        turnIsActive = runtimeSurface.providerTurnActive ?? true
    }

    init(message: NativeLiveCurrentPathMessage) {
        prepareID = message.activity?.prepareId
        tools = Self.tools(from: message.blocks)
        tasks = Self.tasks(
            from: message.activity?.events ?? []
        )
        interactions = message.activity?.interactions ?? []
        turnIsActive = false
    }

    private static func tools(
        from events: [NativeLiveRuntimeEventSnapshot]
    ) -> [ToolActivity] {
        var results:
            [String: NativeLiveRuntimeEventSnapshot] = [:]

        for event in events
        where event.event.type == "tool_result" {
            guard let toolUseID =
                event.event.payload?["tool_use_id"]?.stringValue else {
                continue
            }
            results[toolUseID] = event
        }

        return events.compactMap { event in
            guard event.event.type == "tool_use" else {
                return nil
            }
            let payload = event.event.payload ?? [:]
            let toolUseID =
                payload["tool_use_id"]?.stringValue
                ?? "event-\(event.sequence)"
            let result = results[toolUseID]
            return ToolActivity(
                id: toolUseID,
                toolName:
                    payload["display_name"]?.stringValue
                    ?? payload["tool_name"]?.stringValue
                    ?? "Tool",
                input: payload["input"],
                output: result?.event.payload?["output"],
                state:
                    result == nil
                        ? .running
                        : (
                            result?.event.payload?["is_error"]?.boolValue
                                == true
                            ? .failed
                            : .completed
                        ),
                order: event.sequence
            )
        }
        .sorted { $0.order < $1.order }
    }

    private static func tools(
        from blocks: [NativeLiveCurrentPathBlock]
    ) -> [ToolActivity] {
        let sorted = blocks.sorted {
            $0.ordinal < $1.ordinal
        }
        var results:
            [String: NativeLiveCurrentPathBlock] = [:]

        for block in sorted where block.kind == "tool_result" {
            guard let toolUseID =
                block.payload?["tool_use_id"]?.stringValue else {
                continue
            }
            results[toolUseID] = block
        }

        return sorted.compactMap { block in
            guard block.kind == "tool_use" else {
                return nil
            }
            let payload = block.payload ?? [:]
            let toolUseID =
                payload["tool_use_id"]?.stringValue
                ?? "block-\(block.id)"
            let result = results[toolUseID]
            return ToolActivity(
                id: toolUseID,
                toolName:
                    payload["display_name"]?.stringValue
                    ?? payload["tool_name"]?.stringValue
                    ?? "Tool",
                input: payload["input"],
                output: result?.payload?["output"],
                state:
                    result == nil
                        ? .running
                        : (
                            result?.payload?["is_error"]?.boolValue
                                == true
                            ? .failed
                            : .completed
                        ),
                order: block.ordinal
            )
        }
        .sorted { $0.order < $1.order }
    }

    private static func tasks(
        from events: [NativeLiveRuntimeEventSnapshot]
    ) -> [TaskActivity] {
        var values: [String: TaskActivity] = [:]

        for event in events
        where event.event.type == "task" {
            let payload = event.event.payload ?? [:]
            let phase = payload["phase"]?.stringValue

            if phase == "active_set",
               let activeTasks = payload["tasks"]?.arrayValue {
                for value in activeTasks {
                    guard let object = value.objectValue,
                          let taskID =
                            object["task_id"]?.stringValue else {
                        continue
                    }
                    var task = values[taskID]
                        ?? TaskActivity(
                            id: taskID,
                            order: event.sequence
                        )
                    task.phase = phase
                    task.taskType =
                        object["task_type"]?.stringValue
                        ?? task.taskType
                    task.description =
                        object["description"]?.stringValue
                        ?? task.description
                    if let ambient =
                        object["ambient"]?.boolValue {
                        task.isBackgrounded = ambient
                    }
                    task.order = min(
                        task.order,
                        event.sequence
                    )
                    values[taskID] = task
                }
                continue
            }

            guard let taskID =
                payload["task_id"]?.stringValue else {
                continue
            }

            var task = values[taskID]
                ?? TaskActivity(
                    id: taskID,
                    order: event.sequence
                )
            task.phase = phase ?? task.phase
            task.toolUseID =
                payload["tool_use_id"]?.stringValue
                ?? task.toolUseID
            task.description =
                payload["description"]?.stringValue
                ?? task.description
            task.summary =
                payload["summary"]?.stringValue
                ?? task.summary
            task.subagentType =
                payload["subagent_type"]?.stringValue
                ?? task.subagentType
            task.taskType =
                payload["task_type"]?.stringValue
                ?? task.taskType

            if let backgrounded =
                payload["is_backgrounded"]?.boolValue {
                task.isBackgrounded = backgrounded
            }
            if let depth =
                payload["spawn_depth"]?.numberValue {
                task.spawnDepth = Int(depth)
            }

            if phase == "updated",
               let patch = payload["patch"]?.objectValue {
                task.status =
                    patch["status"]?.stringValue
                    ?? task.status
                task.description =
                    patch["description"]?.stringValue
                    ?? task.description
                if let backgrounded =
                    patch["is_backgrounded"]?.boolValue {
                    task.isBackgrounded = backgrounded
                }
            } else if phase == "notification" {
                task.status =
                    payload["status"]?.stringValue
                    ?? task.status
            }

            task.order = min(task.order, event.sequence)
            values[taskID] = task
        }

        return values.values.sorted {
            if $0.order == $1.order {
                return $0.id < $1.id
            }
            return $0.order < $1.order
        }
    }
}

private extension NativeLiveTurnActivityProjection.TaskActivity {
    init(
        id: String,
        order: Int
    ) {
        self.init(
            id: id,
            toolUseID: nil,
            description: nil,
            summary: nil,
            subagentType: nil,
            taskType: nil,
            isBackgrounded: nil,
            spawnDepth: nil,
            phase: nil,
            status: nil,
            order: order
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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                isExpanded.toggle()
            } label: {
                HStack(spacing: 9) {
                    stateIcon

                    VStack(alignment: .leading, spacing: 2) {
                        Text(projection.headerTitle)
                            .font(.system(
                                size: 14,
                                weight: .medium
                            ))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        HStack(spacing: 6) {
                            Text(projection.stateLabel)

                            Text("·")

                            Text(
                                projection.activityCount == 1
                                    ? "1 activity"
                                    : "\(projection.activityCount) activities"
                            )
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 8)

                    Image(
                        systemName:
                            effectiveExpanded
                                ? "chevron.up"
                                : "chevron.down"
                    )
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if effectiveExpanded {
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(projection.tasks) { task in
                        NativeLiveTaskActivityRow(task: task)
                    }

                    ForEach(projection.tools) { tool in
                        NativeLiveToolCallCard(
                            toolName: tool.toolName,
                            detail: nativeLiveJSONDetail(
                                tool.input
                            ),
                            resultDetail: nativeLiveJSONDetail(
                                tool.output
                            ),
                            state: tool.state
                        )
                    }

                    ForEach(projection.interactions) { interaction in
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
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 10)
        .background(
            Color.primary.opacity(0.035),
            in: RoundedRectangle(
                cornerRadius: 12,
                style: .continuous
            )
        )
        .onAppear {
            if projection.hasPendingInteraction {
                isExpanded = true
            }
        }
        .onChange(
            of: projection.pendingInteractionIDs
        ) { _, ids in
            if !ids.isEmpty {
                isExpanded = true
            }
        }
    }

    private var effectiveExpanded: Bool {
        isExpanded || projection.hasPendingInteraction
    }

    @ViewBuilder
    private var stateIcon: some View {
        if projection.hasPendingInteraction {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        } else if projection.hasFailure {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        } else if projection.turnIsActive {
            ProgressView()
                .controlSize(.small)
        } else {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
    }
}

private struct NativeLiveTaskActivityRow: View {
    let task: NativeLiveTurnActivityProjection.TaskActivity

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            taskIcon
                .frame(width: 15, height: 18)

            VStack(alignment: .leading, spacing: 3) {
                Text(task.displayTitle)
                    .font(.system(size: 13.5, weight: .medium))
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
        } else if task.isTerminal {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
        } else {
            ProgressView()
                .controlSize(.mini)
        }
    }
}

private struct NativeLiveInteractionHistoryRow: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot

    var body: some View {
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
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(1)

            Spacer(minLength: 8)

            Text(interaction.status.capitalized)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 5)
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

private struct NativeLiveRuntimeToolCallRow: View {
    let toolUse: NativeLiveRuntimeEventSnapshot
    let events: [NativeLiveRuntimeEventSnapshot]

    private var toolUseID: String? {
        toolUse.event.payload?["tool_use_id"]?.stringValue
    }

    private var result: NativeLiveRuntimeEventSnapshot? {
        guard let toolUseID else { return nil }
        return events.last(where: { event in
            event.event.type == "tool_result"
                && event.event.payload?["tool_use_id"]?.stringValue
                    == toolUseID
        })
    }

    var body: some View {
        NativeLiveToolCallCard(
            toolName:
                toolUse.event.payload?["display_name"]?.stringValue
                ?? toolUse.event.payload?["tool_name"]?.stringValue
                ?? "Tool",
            detail: nativeLiveJSONDetail(
                toolUse.event.payload?["input"]
            ),
            state:
                result == nil
                    ? .running
                    : (
                        result?.event.payload?["is_error"]?.boolValue
                            == true
                        ? .failed
                        : .completed
                    )
        )
    }
}


enum NativeLiveToolCallState {
    case running
    case completed
    case failed
}


struct NativeLiveToolCallCard: View {
    let toolName: String
    let detail: String?
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
                detail: detail
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


private func nativeLiveToolDisplayName(
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
