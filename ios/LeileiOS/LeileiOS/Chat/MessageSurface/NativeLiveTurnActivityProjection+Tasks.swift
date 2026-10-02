import Foundation

extension NativeLiveTurnActivityProjection {
    static func tasks(
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

            for taskID in values.keys {
                guard var task = values[taskID],
                      task.isBackgrounded == true,
                      !task.isTerminal else {
                    continue
                }
                task.isActiveInBackgroundSet =
                    activeTaskIDs.contains(taskID)
                values[taskID] = task
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
                task.isActiveInBackgroundSet = true
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
            isActiveInBackgroundSet: nil,
            hiddenFromTranscript: false,
            spawnDepth: nil,
            phase: nil,
            status: nil,
            order: order
        )
    }
}
