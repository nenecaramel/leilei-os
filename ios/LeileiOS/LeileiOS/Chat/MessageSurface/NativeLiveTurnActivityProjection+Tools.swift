import Foundation

extension NativeLiveTurnActivityProjection {
    static func tools(
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
                hiddenFromTranscript:
                    payload["hidden_from_transcript"]?.boolValue
                        == true,
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
                    hiddenFromTranscript: false,
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

    static func tools(
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
}
