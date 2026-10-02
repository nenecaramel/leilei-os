import Foundation

extension NativeLiveTurnActivityProjection {
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
}
