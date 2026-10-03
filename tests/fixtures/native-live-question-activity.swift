import Foundation

func value(_ raw: Any) -> NativeLiveJSONValue {
    try! JSONDecoder().decode(NativeLiveJSONValue.self, from: JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed]))
}
func block(_ kind: String, _ payload: [String: Any], _ ordinal: Int) -> NativeLiveCurrentPathBlock {
    NativeLiveCurrentPathBlock(id: "b\(ordinal)", ordinal: ordinal, kind: kind, rawType: kind, text: nil, payload: value(payload).objectValue, createdAt: "2026-10-03T00:00:00Z")
}
func event(_ type: String, _ payload: [String: Any], _ sequence: Int) -> NativeLiveRuntimeEventSnapshot {
    NativeLiveRuntimeEventSnapshot(sequence: sequence, event: .init(type: type, providerSessionID: nil, payload: value(payload).objectValue), createdAt: "2026-10-03T00:00:00Z")
}
let questions: [[String: Any]] = [["question": "Theme?", "header": "Theme", "options": [["label": "Dark"]]]]
let input: [String: Any] = ["questions": questions]
let use: [String: Any] = ["tool_use_id": "q1", "tool_name": "AskUserQuestion", "display_name": "Never use this identity", "input": input]
let answered: [String: Any] = ["tool_use_id": "q1", "output": "provider output", "question_activity": ["kind": "question", "resolution": "answered", "answers": ["Theme?": "Dark"]]]
let cancelled: [String: Any] = ["tool_use_id": "q1", "output": "denied", "is_error": true, "question_activity": ["kind": "question", "resolution": "cancelled", "message": "Dismissed"]]
func interaction(_ status: String, _ response: [String: Any]? = nil) -> NativeLiveRuntimeInteractionSnapshot {
    NativeLiveRuntimeInteractionSnapshot(interactionID: "i1", prepareID: "p1", kind: "question", request: value(["toolUseId": "q1", "questions": questions]).objectValue!, status: status, response: response.flatMap { value($0).objectValue }, createdAt: "2026-10-03T00:00:00Z", updatedAt: "2026-10-03T00:00:00Z", resolvedAt: nil, cancelledAt: nil)
}
func message(_ blocks: [NativeLiveCurrentPathBlock], _ interactions: [NativeLiveRuntimeInteractionSnapshot] = [], _ events: [NativeLiveRuntimeEventSnapshot] = []) -> NativeLiveTurnActivityProjection {
    NativeLiveTurnActivityProjection(message: NativeLiveCurrentPathMessage(id: "m1", conversationId: "c1", parentMessageId: nil, role: "assistant", status: "completed", createdAt: "", completedAt: nil, blocks: blocks, activity: interactions.isEmpty && events.isEmpty ? nil : .init(prepareId: "p1", events: events, interactions: interactions)))
}
let pending = interaction("pending")
let live = NativeLiveTurnActivityProjection(runtimeSurface: .init(prepareID: "p1", conversationID: UUID(), events: [event("tool_use", use, 1)], interactions: [pending], controls: [], nextAfterSequence: 1))
precondition(live.activityCount == 1 && live.tools.isEmpty)
precondition(live.questionActivities.count == 1 && live.questionActivities[0].interaction == pending)
precondition(live.hasPendingInteraction && live.questionActivities[0].statusLabel == "Needs input")
let resolved = interaction("resolved", ["decision": "answer", "answers": ["Theme?": "Runtime richer answer"]])
let retained = message([block("tool_use", use, 0), block("tool_result", answered, 1)], [resolved])
precondition(retained.activityCount == 1 && retained.tools.isEmpty && retained.topLevelInteractions.isEmpty)
precondition(retained.questionActivities[0].statusLabel == "Answered")
precondition(retained.questionActivities[0].responseDetail?.contains("Runtime richer answer") == true)
let expired = message([block("tool_use", use, 0), block("tool_result", answered, 1)])
precondition(expired.hasContent && expired.activityCount == 1 && expired.tools.isEmpty)
precondition(expired.questionActivities[0].statusLabel == "Answered")
precondition(expired.questionActivities[0].questionDetail == "Theme?")
precondition(expired.questionActivities[0].responseDetail?.contains("Dark") == true)
let cancel = message([block("tool_use", use, 0), block("tool_result", cancelled, 1)])
precondition(cancel.activityCount == 1 && cancel.questionActivities[0].statusLabel == "Cancelled")
let noResult = message([block("tool_use", use.merging(["question_activity": ["kind": "question", "resolution": "cancelled"]]) { _, new in new }, 0)])
precondition(noResult.activityCount == 1 && noResult.questionActivities[0].statusLabel == "Cancelled")
let legacy = message([block("tool_use", use, 0), block("tool_result", ["tool_use_id": "q1", "output": "legacy free text", "is_error": true], 1)])
precondition(legacy.activityCount == 1 && legacy.questionActivities[0].statusLabel == "Recorded")
let normalUse: [String: Any] = ["tool_use_id": "read1", "tool_name": "Read", "display_name": "AskUserQuestion", "input": ["path": "x"]]
let normal = message([block("tool_use", normalUse, 0), block("tool_result", ["tool_use_id": "read1", "output": "ok"], 1)])
precondition(normal.activityCount == 1 && normal.questionActivities.isEmpty && normal.tools[0].state == .completed)
let taskEvent = event("task", ["phase": "started", "task_id": "t1", "tool_use_id": "task1", "description": "Research"], 1)
let childUse = use.merging(["parent_tool_use_id": "task1", "parent_agent_id": "agent1"]) { _, new in new }
let nested = message([block("tool_use", childUse, 0), block("tool_result", answered, 1)], [], [taskEvent])
precondition(nested.activityCount == 2 && nested.tasks.count == 1 && nested.topLevelQuestions.isEmpty)
precondition(nested.childQuestions(for: nested.tasks[0]).count == 1)
let nestedRetained = message([block("tool_use", childUse, 0), block("tool_result", answered, 1)], [resolved], [taskEvent])
precondition(nestedRetained.activityCount == 2 && nestedRetained.childQuestions(for: nestedRetained.tasks[0]).count == 1)
let parentExpired = message([block("tool_use", childUse, 0), block("tool_result", answered, 1)])
precondition(parentExpired.activityCount == 1 && parentExpired.topLevelQuestions.isEmpty && parentExpired.unattachedQuestions.count == 1)
precondition(parentExpired.questionActivities[0].parentToolUseID == "task1")
let duplicate = message([block("tool_use", use, 0), block("tool_use", use, 1), block("tool_result", answered, 2)], [resolved, resolved])
precondition(duplicate.activityCount == 1 && duplicate.questionActivities.count == 1)
print("Question activity behavior passed: live, answered, cancelled, retained, expired, normal, nested, duplicate")

let permission = NativeLiveRuntimeInteractionSnapshot(interactionID: "permission1", prepareID: "p1", kind: "permission", request: value(["toolUseId": "read1", "toolName": "Read"]).objectValue!, status: "pending", response: nil, createdAt: "", updatedAt: "", resolvedAt: nil, cancelledAt: nil)
let permittedTool = message([block("tool_use", normalUse, 0)], [permission])
precondition(permittedTool.activityCount == 1 && permittedTool.tools.count == 1 && permittedTool.topLevelInteractions.isEmpty)
precondition(permittedTool.permissionInteractions(for: permittedTool.tools[0]).count == 1)
let standalonePermission = message([], [permission])
precondition(standalonePermission.activityCount == 1 && standalonePermission.topLevelInteractions.count == 1)
let unresolved = message([block("tool_use", use, 0)])
precondition(unresolved.activityCount == 1 && unresolved.questionActivities[0].statusLabel == "Recorded" && !unresolved.hasPendingInteraction)
let taskTool: [String: Any] = ["tool_use_id": "task1", "tool_name": "Agent", "input": ["description": "Research"]]
let durableParent = message([block("tool_use", taskTool, 0), block("tool_use", childUse, 1), block("tool_result", answered, 2)])
precondition(durableParent.activityCount == 2 && durableParent.childQuestions(forToolUseID: "task1").count == 1 && durableParent.unattachedQuestions.isEmpty)
