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
            ].contains(status)
        }

        var isFailed: Bool {
            status == "failed"
        }

        var isCancelled: Bool {
            status == "cancelled" || status == "stopped"
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
        lifecycle.count
            + tools.count
            + tasks.count
            + interactions.count
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

    var headerTitle: String {
        if let pending = pendingInteractions.first {
            if pending.kind == "permission" {
                return pending.permissionTitle
            }
            if let question = pending.questions.first {
                return question.header ?? question.text
            }
        }

        if let lifecycle = lifecycle.last {
            return lifecycle.title
        }

        if let task = tasks
            .filter(\.isCurrentlyActive)
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

        if !turnIsActive,
           let task = tasks
            .sorted(by: { $0.order < $1.order })
            .last {
            return task.displayTitle
        }

        if let tool = tools.sorted(by: { $0.order < $1.order }).last {
            return nativeLiveToolDisplayName(tool.toolName)
        }

        if let interaction = interactions.last {
            if interaction.kind == "permission" {
                return interaction.permissionTitle
            }
            if let question = interaction.questions.first {
                return question.header ?? question.text
            }
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
        if hasActiveBackgroundTask {
            return "Background"
        }
        return "Done"
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
        let hiddenTaskToolUseIDs = Set(
            projectedTasks
                .filter(\.hiddenFromTranscript)
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
            !$0.hiddenFromTranscript
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
                && !taskToolUseIDs.contains($0.id)
                && !questionToolUseIDs.contains($0.id)
                && !hiddenTaskToolUseIDs.contains(
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
        let hiddenTaskToolUseIDs = Set(
            projectedTasks
                .filter(\.hiddenFromTranscript)
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
            !$0.hiddenFromTranscript
        }
        tools = Self.tools(from: message.blocks)
            .filter {
                !$0.hiddenFromTranscript
                    && !taskToolUseIDs.contains($0.id)
                    && !questionToolUseIDs.contains($0.id)
                    && !hiddenTaskToolUseIDs.contains(
                        $0.parentToolUseID ?? ""
                    )
            }
        interactions = projectedInteractions
        turnIsActive = false
        turnFailed = message.status == "error"
    }
}
