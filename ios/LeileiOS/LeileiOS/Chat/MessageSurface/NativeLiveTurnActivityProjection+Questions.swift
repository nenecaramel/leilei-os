import Foundation

extension NativeLiveTurnActivityProjection {
    struct QuestionActivity: Equatable, Identifiable {
        let id: String
        let parentToolUseID: String?
        let parentAgentID: String?
        let questionDetail: String?
        let responseDetail: String?
        let statusLabel: String
        let interaction: NativeLiveRuntimeInteractionSnapshot?
        let order: Int
    }

    func childQuestions(for task: TaskActivity) -> [QuestionActivity] {
        guard let id = task.toolUseID else { return [] }
        return childQuestions(forToolUseID: id)
    }

    func childQuestions(forToolUseID id: String) -> [QuestionActivity] {
        questionActivities.filter { $0.parentToolUseID == id }
    }

    var topLevelQuestions: [QuestionActivity] {
        questionActivities.filter { $0.parentToolUseID == nil && $0.parentAgentID == nil }
    }

    // Keep known provenance when operational task rows have expired. Do not
    // invent a TaskActivity or move a subagent's question into the root turn.
    var unattachedQuestions: [QuestionActivity] {
        let parentIDs = Set(tasks.compactMap(\.toolUseID) + tools.map(\.id))
        return questionActivities.filter {
            ($0.parentToolUseID != nil || $0.parentAgentID != nil)
                && !parentIDs.contains($0.parentToolUseID ?? "")
        }
    }

    static func questions(
        from tools: [ToolActivity],
        interactions: [NativeLiveRuntimeInteractionSnapshot],
        suppressedParentIDs: Set<String>
    ) -> [QuestionActivity] {
        var runtimeByID: [String: NativeLiveRuntimeInteractionSnapshot] = [:]
        for interaction in interactions where interaction.kind == "question" {
            runtimeByID[interaction.toolUseID ?? "interaction-\(interaction.id)"] = interaction
        }
        var values: [String: QuestionActivity] = [:]
        for tool in tools where tool.providerToolName == "AskUserQuestion" || runtimeByID[tool.id] != nil {
            guard values[tool.id] == nil else { continue }
            let interaction = runtimeByID.removeValue(forKey: tool.id)
            guard !tool.hiddenFromTranscript, !tool.hiddenFromActivity,
                  !suppressedParentIDs.contains(tool.parentToolUseID ?? "") else { continue }
            values[tool.id] = question(tool: tool, interaction: interaction, id: tool.id)
        }
        for (id, interaction) in runtimeByID {
            values[id] = question(tool: nil, interaction: interaction, id: id)
        }
        return values.values.sorted { $0.order == $1.order ? $0.id < $1.id : $0.order < $1.order }
    }

    private static func question(
        tool: ToolActivity?,
        interaction: NativeLiveRuntimeInteractionSnapshot?,
        id: String
    ) -> QuestionActivity {
        let input = tool?.input?.objectValue
        let metadata = tool?.questionMetadata?.objectValue
        let questionValues = interaction?.request["questions"]?.arrayValue
            ?? input?["questions"]?.arrayValue ?? []
        let text = questionValues.compactMap { $0.objectValue?["question"]?.stringValue }
            .joined(separator: "\n\n")
        let response = interaction?.response
        // Structured answers in existing blocks remain useful for older turns.
        // Free-text tool_result and is_error alone cannot establish cancellation.
        let answers = response?["answers"]?.objectValue
            ?? metadata?["answers"]?.objectValue
            ?? tool?.output?.objectValue?["answers"]?.objectValue
            ?? input?["answers"]?.objectValue
        let status: String
        if interaction?.isPending == true {
            status = "Needs input"
        } else if interaction?.status == "cancelled" || response?["decision"]?.stringValue == "cancel" {
            status = "Cancelled"
        } else if response?["decision"]?.stringValue == "answer" {
            status = "Answered"
        } else if interaction == nil, metadata?["kind"]?.stringValue == "question",
                  metadata?["resolution"]?.stringValue == "cancelled" {
            status = "Cancelled"
        } else if interaction == nil, metadata?["kind"]?.stringValue == "question",
                  metadata?["resolution"]?.stringValue == "answered" {
            status = "Answered"
        } else if answers?.isEmpty == false {
            status = "Answered"
        } else {
            status = "Recorded"
        }
        let responseText = answers.map { values in
            values.keys.sorted().compactMap { key in
                values[key]?.stringValue.map { "\(key)\n\($0)" }
            }.joined(separator: "\n\n")
        } ?? response?["message"]?.stringValue
            ?? metadata?["message"]?.stringValue
            ?? tool?.output?.stringValue
        return QuestionActivity(
            id: id,
            parentToolUseID: tool?.parentToolUseID
                ?? interaction?.request["parent_tool_use_id"]?.stringValue,
            parentAgentID: tool?.parentAgentID
                ?? interaction?.request["parent_agent_id"]?.stringValue,
            questionDetail: text.isEmpty ? nil : text,
            responseDetail: responseText,
            statusLabel: status,
            interaction: interaction,
            order: tool?.order ?? Int.max
        )
    }
}
