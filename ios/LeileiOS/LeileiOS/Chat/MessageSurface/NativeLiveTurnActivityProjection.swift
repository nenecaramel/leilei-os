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
        let parentToolUseID: String?
        let parentAgentID: String?
        var state: NativeLiveToolCallState
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
                .compactMap {
                    $0.request["toolUseId"]?.stringValue
                }
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
            !taskToolUseIDs.contains($0.id)
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
                .compactMap {
                    $0.request["toolUseId"]?.stringValue
                }
        )
        tasks = projectedTasks.filter {
            !$0.hiddenFromTranscript
        }
        tools = Self.tools(from: message.blocks)
            .filter {
                !taskToolUseIDs.contains($0.id)
                    && !questionToolUseIDs.contains($0.id)
                    && !hiddenTaskToolUseIDs.contains(
                        $0.parentToolUseID ?? ""
                    )
            }
        interactions = projectedInteractions
        turnIsActive = false
        turnFailed = message.status == "error"
    }

    private static func lifecycle(
        from events: [NativeLiveRuntimeEventSnapshot]
    ) -> [LifecycleActivity] {
        var candidates: [LifecycleActivity] = []
        var latestCommandEvents:
            [String: NativeLiveRuntimeEventSnapshot] = [:]

        for event in events
        where event.event.type == "runtime" {
            let payload = event.event.payload ?? [:]
            switch payload["kind"]?.stringValue {
            case "album_saved":
                candidates.append(
                    LifecycleActivity(
                        id: "album-saved-\(event.sequence)",
                        kind: "album_saved",
                        title: "Saved a photo to Album",
                        detail: nil,
                        order: event.sequence
                    )
                )

            case "api_retry":
                let attempt = payload["attempt"]?.numberValue
                let maxRetries =
                    payload["max_retries"]?.numberValue
                let detail: String?
                if let attempt, let maxRetries {
                    detail =
                        "\(Int(attempt)) / \(Int(maxRetries))"
                } else {
                    detail = nil
                }
                candidates.append(
                    LifecycleActivity(
                        id: "api-retry-\(event.sequence)",
                        kind: "api_retry",
                        title: "Retrying request",
                        detail: detail,
                        order: event.sequence
                    )
                )

            case "command_lifecycle":
                guard let commandUUID =
                    payload["command_uuid"]?.stringValue else {
                    continue
                }
                latestCommandEvents[commandUUID] = event

            default:
                continue
            }
        }

        for event in latestCommandEvents.values {
            let payload = event.event.payload ?? [:]
            let state = payload["state"]?.stringValue
            let title: String
            switch state {
            case "queued":
                title = "Message queued"
            case "started":
                title = "Message started"
            default:
                continue
            }
            candidates.append(
                LifecycleActivity(
                    id: "command-\(payload["command_uuid"]?.stringValue ?? String(event.sequence))",
                    kind: "command_lifecycle",
                    title: title,
                    detail: state,
                    order: event.sequence
                )
            )
        }

        guard let latest = candidates.max(
            by: { $0.order < $1.order }
        ) else {
            return []
        }

        let hasLaterExecutionActivity =
            events.contains { event in
                guard event.sequence > latest.order else {
                    return false
                }

                if [
                    "partial_text",
                    "text",
                    "tool_use",
                    "tool_result",
                    "task",
                    "result",
                    "error",
                ].contains(event.event.type) {
                    return true
                }

                guard event.event.type == "runtime",
                      event.event.payload?["kind"]?.stringValue
                        == "command_lifecycle" else {
                    return false
                }

                let state =
                    event.event.payload?["state"]?.stringValue
                return [
                    "cancelled",
                    "discarded",
                    "refused",
                    "completed",
                ].contains(state ?? "")
            }

        return hasLaterExecutionActivity ? [] : [latest]
    }

    private static func tools(
        from events: [NativeLiveRuntimeEventSnapshot]
    ) -> [ToolActivity] {
        let toolUseEvents = events.filter {
            $0.event.type == "tool_use"
        }
        let resultEvents = events.filter {
            $0.event.type == "tool_result"
        }

        var results:
            [String: NativeLiveRuntimeEventSnapshot] = [:]
        for event in resultEvents {
            guard let toolUseID =
                event.event.payload?["tool_use_id"]?.stringValue else {
                continue
            }
            results[toolUseID] = event
        }

        let knownToolUseIDs = Set(
            toolUseEvents.compactMap {
                $0.event.payload?["tool_use_id"]?.stringValue
            }
        )

        var activities = toolUseEvents.map { event in
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
                parentToolUseID:
                    payload["parent_tool_use_id"]?.stringValue,
                parentAgentID:
                    payload["parent_agent_id"]?.stringValue,
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

        activities.append(
            contentsOf: resultEvents.compactMap { event in
                let payload = event.event.payload ?? [:]
                if let toolUseID =
                    payload["tool_use_id"]?.stringValue,
                   knownToolUseIDs.contains(toolUseID) {
                    return nil
                }

                return ToolActivity(
                    id: "result-\(event.sequence)",
                    toolName: "Tool result",
                    input: nil,
                    output: payload["output"],
                    parentToolUseID: nil,
                    parentAgentID: nil,
                    state:
                        payload["is_error"]?.boolValue == true
                            ? .failed
                            : .completed,
                    order: event.sequence
                )
            }
        )

        return activities.sorted {
            $0.order < $1.order
        }
    }

    private static func tools(
        from blocks: [NativeLiveCurrentPathBlock]
    ) -> [ToolActivity] {
        let sorted = blocks.sorted {
            $0.ordinal < $1.ordinal
        }
        let toolUseBlocks = sorted.filter {
            $0.kind == "tool_use"
        }
        let resultBlocks = sorted.filter {
            $0.kind == "tool_result"
        }

        var results:
            [String: NativeLiveCurrentPathBlock] = [:]
        for block in resultBlocks {
            guard let toolUseID =
                block.payload?["tool_use_id"]?.stringValue else {
                continue
            }
            results[toolUseID] = block
        }

        let knownToolUseIDs = Set(
            toolUseBlocks.compactMap {
                $0.payload?["tool_use_id"]?.stringValue
            }
        )

        var activities = toolUseBlocks.map { block in
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
                parentToolUseID:
                    payload["parent_tool_use_id"]?.stringValue,
                parentAgentID:
                    payload["parent_agent_id"]?.stringValue,
                state:
                    result == nil
                        ? .unknown
                        : (
                            result?.payload?["is_error"]?.boolValue
                                == true
                            ? .failed
                            : .completed
                        ),
                order: block.ordinal
            )
        }

        activities.append(
            contentsOf: resultBlocks.compactMap { block in
                let payload = block.payload ?? [:]
                if let toolUseID =
                    payload["tool_use_id"]?.stringValue,
                   knownToolUseIDs.contains(toolUseID) {
                    return nil
                }

                return ToolActivity(
                    id: "result-\(block.id)",
                    toolName: "Tool result",
                    input: nil,
                    output: payload["output"],
                    parentToolUseID: nil,
                    parentAgentID: nil,
                    state:
                        payload["is_error"]?.boolValue == true
                            ? .failed
                            : .completed,
                    order: block.ordinal
                )
            }
        )

        return activities.sorted {
            $0.order < $1.order
        }
    }

    private static func tasks(
        from events: [NativeLiveRuntimeEventSnapshot]
    ) -> [TaskActivity] {
        var values: [String: TaskActivity] = [:]
        var latestActiveSet:
            (sequence: Int, tasks: [NativeLiveJSONValue])?

        for event in events
        where event.event.type == "task" {
            let payload = event.event.payload ?? [:]
            let phase = payload["phase"]?.stringValue

            if phase == "active_set" {
                if let activeTasks = payload["tasks"]?.arrayValue {
                    latestActiveSet = (
                        sequence: event.sequence,
                        tasks: activeTasks
                    )
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
            } else if payload["ambient"]?.boolValue == true {
                task.isBackgrounded = true
            }
            if payload["hidden_from_transcript"]?.boolValue == true {
                task.hiddenFromTranscript = true
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

        if let latestActiveSet {
            let activeTaskIDs = Set(
                latestActiveSet.tasks.compactMap { value in
                    value.objectValue?["task_id"]?.stringValue
                }
            )

            values = values.filter { taskID, task in
                task.phase != "active_set"
                    || activeTaskIDs.contains(taskID)
            }

            for value in latestActiveSet.tasks {
                guard let object = value.objectValue,
                      let taskID =
                        object["task_id"]?.stringValue else {
                    continue
                }
                var task = values[taskID]
                    ?? TaskActivity(
                        id: taskID,
                        order: latestActiveSet.sequence
                    )
                if task.phase == nil {
                    task.phase = "active_set"
                }
                task.taskType =
                    object["task_type"]?.stringValue
                    ?? task.taskType
                task.description =
                    object["description"]?.stringValue
                    ?? task.description
                if task.isBackgrounded == nil {
                    task.isBackgrounded = true
                }
                task.order = min(
                    task.order,
                    latestActiveSet.sequence
                )
                values[taskID] = task
            }
        }

        return values.values
            .sorted {
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
            hiddenFromTranscript: false,
            spawnDepth: nil,
            phase: nil,
            status: nil,
            order: order
        )
    }
}
