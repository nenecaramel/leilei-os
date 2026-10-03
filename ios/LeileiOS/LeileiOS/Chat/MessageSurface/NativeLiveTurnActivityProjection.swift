import Foundation

struct NativeLiveTurnActivityProjection: Equatable {
    struct LifecycleActivity: Equatable, Identifiable {
        let id: String
        let kind: String
        let title: String
        let detail: String?
        let order: Int
    }

    struct ToolActivity: Equatable, Identifiable {
        let id: String
        let toolName: String
        let input: NativeLiveJSONValue?
        let output: NativeLiveJSONValue?
        let resourceLinks: [NativeLiveJSONValue]
        let parentToolUseID: String?
        let parentAgentID: String?
        let hiddenFromTranscript: Bool
        let hiddenFromActivity: Bool
        var state: NativeLiveToolCallState
        let order: Int
    }

    struct TaskActivity: Equatable, Identifiable {
        let id: String
        var toolUseID: String?
        var description: String?
        var summary: String?
        var resourceLinks: [NativeLiveJSONValue]
        var subagentType: String?
        var taskType: String?
        var isBackgrounded: Bool?
        var isAmbient: Bool
        var isActiveInBackgroundSet: Bool?
        var hiddenFromTranscript: Bool
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
                "stopped",
                "killed",
            ].contains(status)
        }

        var isFailed: Bool {
            status == "failed"
        }

        var isCancelled: Bool {
            status == "cancelled"
                || status == "stopped"
                || status == "killed"
        }

        var isCurrentlyActive: Bool {
            !isTerminal
                && isActiveInBackgroundSet != false
        }

        var isActiveBackgroundTask: Bool {
            isBackgrounded == true
                && isCurrentlyActive
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
    let lifecycle: [LifecycleActivity]
    let tools: [ToolActivity]
    let tasks: [TaskActivity]
    let interactions: [NativeLiveRuntimeInteractionSnapshot]
    let turnIsActive: Bool
    let turnFailed: Bool
    let elapsedSeconds: Int?

    var hasContent: Bool {
        !lifecycle.isEmpty
            || !tools.isEmpty
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

    var hasActiveBackgroundTask: Bool {
        tasks.contains(where: \.isActiveBackgroundTask)
    }

    var hasFailure: Bool {
        turnFailed
            || tools.contains { $0.state == .failed }
            || tasks.contains(where: \.isFailed)
    }

    var activityCount: Int {
        tools.count + tasks.count + interactions.count
    }

    func childTools(
        for task: TaskActivity
    ) -> [ToolActivity] {
        guard let toolUseID = task.toolUseID else {
            return []
        }
        return tools.filter {
            $0.parentToolUseID == toolUseID
        }
    }

    var topLevelTools: [ToolActivity] {
        let nestedToolIDs = Set(
            tasks.flatMap { task in
                childTools(for: task).map(\.id)
            }
        )
        return tools.filter {
            !nestedToolIDs.contains($0.id)
        }
    }

    func permissionInteractions(
        for tool: ToolActivity
    ) -> [NativeLiveRuntimeInteractionSnapshot] {
        interactions.filter {
            $0.kind == "permission"
                && $0.toolUseID == tool.id
        }
    }

    var topLevelInteractions:
        [NativeLiveRuntimeInteractionSnapshot] {
        let nestedInteractionIDs = Set(
            tools.flatMap { tool in
                permissionInteractions(for: tool).map(\.id)
            }
        )
        return interactions.filter {
            !nestedInteractionIDs.contains($0.id)
        }
    }

    var summaryLabel: String {
        var components: [String] = []

        if hasPendingInteraction {
            components.append(
                turnIsActive
                    ? workingDurationLabel
                    : workedDurationLabel
            )
            components.append("Needs input")
        } else if hasFailure {
            components.append(workedDurationLabel)
            components.append("Failed")
        } else if hasActiveBackgroundTask && !turnIsActive {
            components.append("Working in background")
        } else if turnIsActive {
            components.append(workingDurationLabel)
        } else {
            components.append(workedDurationLabel)
            components.append("Done")
        }

        if activityCount > 0 {
            components.append(
                activityCount == 1
                    ? "1 activity"
                    : "\(activityCount) activities"
            )
        }

        return components
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var workingDurationLabel: String {
        guard let elapsedSeconds else {
            return "Working"
        }
        return "Working for \(Self.durationText(elapsedSeconds))"
    }

    private var workedDurationLabel: String {
        guard let elapsedSeconds else {
            return ""
        }
        return "Worked for \(Self.durationText(elapsedSeconds))"
    }

    private static func durationText(_ seconds: Int) -> String {
        let value = max(seconds, 0)
        if value >= 3_600 {
            let hours = value / 3_600
            let minutes = (value % 3_600) / 60
            return minutes > 0
                ? "\(hours)h \(minutes)m"
                : "\(hours)h"
        }
        if value >= 60 {
            let minutes = value / 60
            let remainingSeconds = value % 60
            return remainingSeconds > 0
                ? "\(minutes)m \(remainingSeconds)s"
                : "\(minutes)m"
        }
        return "\(value)s"
    }

    private static func runtimeElapsedSeconds(
        from events: [NativeLiveRuntimeEventSnapshot],
        interactions: [NativeLiveRuntimeInteractionSnapshot],
        turnIsActive: Bool
    ) -> Int? {
        if let durationMs = events.reversed().compactMap({ event -> Double? in
            guard event.event.type == "result" else {
                return nil
            }
            return event.event.payload?["duration_ms"]?.numberValue
        }).first,
           durationMs >= 0 {
            return max(1, Int((durationMs / 1_000).rounded()))
        }

        guard turnIsActive else {
            return nil
        }

        let timestamps =
            events.map(\.createdAt)
            + interactions.map(\.createdAt)
        guard let earliest = timestamps.compactMap(parseISO8601)
            .min() else {
            return nil
        }

        return max(
            0,
            Int(Date().timeIntervalSince(earliest).rounded(.down))
        )
    }

    private static func parseISO8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    init(runtimeSurface: NativeLiveRuntimeSurfaceState) {
        prepareID = runtimeSurface.prepareID
        lifecycle = Self.lifecycle(
            from: runtimeSurface.events
        )
        let projectedTasks = Self.tasks(
            from: runtimeSurface.events
        )
        let taskToolUseIDs = Set(
            projectedTasks.compactMap(\.toolUseID)
        )
        let suppressedTaskToolUseIDs = Set(
            projectedTasks
                .filter {
                    $0.hiddenFromTranscript || $0.isAmbient
                }
                .compactMap(\.toolUseID)
        )
        let questionToolUseIDs = Set(
            runtimeSurface.interactions
                .filter { $0.kind == "question" }
                .compactMap(\.toolUseID)
        )
        let sawTerminalEvent =
            runtimeSurface.events.contains { event in
                event.event.type == "result"
                    || event.event.type == "error"
            }
        let projectedTurnIsActive =
            runtimeSurface.providerTurnActive
            ?? !sawTerminalEvent
        tasks = projectedTasks.filter {
            !$0.hiddenFromTranscript && !$0.isAmbient
        }
        var projectedTools = Self.tools(
            from: runtimeSurface.events
        )
        if !projectedTurnIsActive {
            for index in projectedTools.indices
            where projectedTools[index].state == .running {
                projectedTools[index].state = .unknown
            }
        }
        tools = projectedTools.filter {
            !$0.hiddenFromTranscript
                && !$0.hiddenFromActivity
                && !taskToolUseIDs.contains($0.id)
                && !questionToolUseIDs.contains($0.id)
                && !suppressedTaskToolUseIDs.contains(
                    $0.parentToolUseID ?? ""
                )
        }
        interactions = runtimeSurface.interactions
        turnIsActive = projectedTurnIsActive
        turnFailed = runtimeSurface.events.contains { event in
            event.event.type == "error"
                || (
                    event.event.type == "result"
                    && event.event.payload?["status"]?.stringValue
                        == "error"
                )
        }
        elapsedSeconds = Self.runtimeElapsedSeconds(
            from: runtimeSurface.events,
            interactions: runtimeSurface.interactions,
            turnIsActive: projectedTurnIsActive
        )
    }

    init(message: NativeLiveCurrentPathMessage) {
        prepareID = message.activity?.prepareId
        lifecycle = []
        let projectedTasks = Self.tasks(
            from: message.activity?.events ?? []
        )
        let taskToolUseIDs = Set(
            projectedTasks.compactMap(\.toolUseID)
        )
        let suppressedTaskToolUseIDs = Set(
            projectedTasks
                .filter {
                    $0.hiddenFromTranscript || $0.isAmbient
                }
                .compactMap(\.toolUseID)
        )
        let projectedInteractions =
            message.activity?.interactions ?? []
        let questionToolUseIDs = Set(
            projectedInteractions
                .filter { $0.kind == "question" }
                .compactMap(\.toolUseID)
        )
        tasks = projectedTasks.filter {
            !$0.hiddenFromTranscript && !$0.isAmbient
        }
        tools = Self.tools(from: message.blocks)
            .filter {
                !$0.hiddenFromTranscript
                    && !$0.hiddenFromActivity
                    && !taskToolUseIDs.contains($0.id)
                    && !questionToolUseIDs.contains($0.id)
                    && !suppressedTaskToolUseIDs.contains(
                        $0.parentToolUseID ?? ""
                    )
            }
        interactions = projectedInteractions
        turnIsActive = false
        turnFailed = message.status == "error"
        elapsedSeconds = nil
    }
}
