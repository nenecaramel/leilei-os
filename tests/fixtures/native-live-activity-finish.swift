// Appended to the existing real question projection fixture so #813 is verified too.
func historicalDuration(_ milliseconds: Any?, prepareID: Any = "p1") -> NativeLiveTurnActivityProjection {
    var activity: [String: Any] = ["prepareId": prepareID, "events": [], "interactions": []]
    if let milliseconds { activity["durationMs"] = milliseconds }
    let decoded = try! JSONDecoder().decode(NativeLiveMessageActivitySnapshot.self, from: JSONSerialization.data(withJSONObject: activity))
    return NativeLiveTurnActivityProjection(message: NativeLiveCurrentPathMessage(id: "m1", conversationId: "c1", parentMessageId: nil, role: "assistant", status: "completed", createdAt: "2000-01-01T00:00:00Z", completedAt: "2099-01-01T00:00:00Z", blocks: [block("tool_use", normalUse, 0), block("tool_result", ["tool_use_id": "read1", "output": "ok"], 1)], activity: decoded), elapsed: (milliseconds as? Int).flatMap { $0 >= 0 ? max(1, Int((Double($0)/1000).rounded())) : nil })
}
let activityClockFormatter = ISO8601DateFormatter()
activityClockFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
let activeEvent = NativeLiveRuntimeEventSnapshot(sequence: 1, event: .init(type: "tool_use", providerSessionID: nil, payload: value(normalUse).objectValue), createdAt: "2026-10-04T10:00:09.000Z")
let activeDuration = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [activeEvent], interactions: [], controls: [], nextAfterSequence: 1), elapsed: 18)
precondition(activeDuration.summaryLabel.hasPrefix("Working for 18s"))
let nativeFinal = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [activeEvent, event("result", ["duration_ms": 18_000], 2)], interactions: [], controls: [], nextAfterSequence: 2), elapsed: 18)
let finalDuration = historicalDuration(18_000)
precondition(nativeFinal.elapsedSeconds == 18 && finalDuration.elapsedSeconds == 18)
precondition(finalDuration.summaryLabel == "Worked for 18s · 1 step")
precondition(historicalDuration(18_000).summaryLabel == finalDuration.summaryLabel)
precondition(historicalDuration(18_000, prepareID: NSNull()).summaryLabel == finalDuration.summaryLabel)
for (milliseconds, label) in [(0, "1s"), (18_000, "18s"), (61_000, "1m 1s"), (3_600_000, "1h"), (3_660_000, "1h 1m")] {
    precondition(historicalDuration(milliseconds).summaryLabel == "Worked for \(label) · 1 step")
}
for unknown in [nil, NSNull(), -1] as [Any?] {
    precondition(historicalDuration(unknown).summaryLabel == "1 step")
}
let noSteps = NativeLiveTurnActivityProjection(message: .init(id: "m1", conversationId: "c1", parentMessageId: nil, role: "assistant", status: "completed", createdAt: "", completedAt: nil, blocks: [], activity: try! JSONDecoder().decode(NativeLiveMessageActivitySnapshot.self, from: Data("{\"prepareId\":null,\"durationMs\":18000,\"events\":[],\"interactions\":[]}".utf8))), elapsed: 18)
precondition(noSteps.hasContent && noSteps.activityCount == 0 && noSteps.summaryLabel == "Thought for 18s")
let longClock = NativeLiveRuntimeEventSnapshot(sequence: 1, event: activeEvent.event, createdAt: "2000-01-01T00:00:00Z")
let authoritativeFinal = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [longClock, event("result", ["duration_ms": 18_000], 2)], interactions: [], controls: [], nextAfterSequence: 2))
precondition(authoritativeFinal.elapsedSeconds == nil) // Projection cannot derive a second clock from tool time or duration_ms.
precondition(finalDuration.lifecycle.isEmpty)

func permissionHistory(_ status: String, _ decision: String?) -> NativeLiveRuntimeInteractionSnapshot {
    NativeLiveRuntimeInteractionSnapshot(interactionID: "permission1", prepareID: "p1", kind: "permission", request: value(["toolUseId": "read1", "toolName": "Edit", "title": "Edit"]).objectValue!, status: status, response: decision.map { ["decision": .string($0)] }, createdAt: "", updatedAt: "", resolvedAt: nil, cancelledAt: nil)
}
let nestedPresentation = NativeLiveInteractionHistoryPresentation.nestedPermission
for (status, decision, expected) in [("resolved", "allow", "Allowed"), ("resolved", "deny", "Denied"), ("resolved", nil, "Resolved"), ("resolved", "unknown", "Resolved"), ("cancelled", "allow", "Cancelled"), ("pending", nil, "Pending")] {
    let interaction = permissionHistory(status, decision)
    precondition(nestedPresentation.title(for: interaction) == "Permission")
    precondition(nestedPresentation.statusLabel(for: interaction) == expected)
    precondition(NativeLiveInteractionHistoryPresentation.standard.title(for: interaction) == "Edit")
    precondition(NativeLiveInteractionHistoryPresentation.standard.statusLabel(for: interaction) == status.capitalized)
    let projection = message([block("tool_use", normalUse, 0)], [interaction])
    precondition(projection.activityCount == 1 && projection.topLevelInteractions.isEmpty)
}
precondition(nestedPresentation.title(for: resolved) != "Permission")
precondition(live.questionActivities[0].statusLabel == "Needs input" && cancel.questionActivities[0].statusLabel == "Cancelled")
print("Activity finish behavior passed: duration handoff, refresh, retention, formatting, nested permission, question regressions")

let liveLifecycle = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [event("runtime", ["kind": "command_lifecycle", "command_uuid": "command1", "state": "started"], 1)], interactions: [], controls: [], nextAfterSequence: 1))
precondition(liveLifecycle.lifecycle.count == 1 && liveLifecycle.lifecycle[0].title == "Message started")
let backgroundActivity = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [event("task", ["phase": "started", "task_id": "background1", "description": "Research", "is_backgrounded": true], 1), event("result", ["duration_ms": 18_000], 2)], interactions: [], controls: [], nextAfterSequence: 2))
precondition(backgroundActivity.hasActiveBackgroundTask && backgroundActivity.summaryLabel == "Working in background · 1 step")
