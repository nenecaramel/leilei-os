import Foundation

let fixtures = try JSONDecoder().decode(
    [String: [NativeLiveCurrentPathBlock]].self,
    from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
)
for name in ["ordinary", "hidden", "ambient"] {
    let blocks = fixtures[name]!
    let message = NativeLiveCurrentPathMessage(
        id: name, conversationId: "c1", parentMessageId: nil,
        role: "assistant", status: "completed", createdAt: "",
        completedAt: nil, blocks: blocks, activity: nil
    )
    // No operational events/interactions: historical reconstruction uses only ledger rows.
    let projection = NativeLiveTurnActivityProjection(message: message)
    precondition(projection.activityCount == 1 && projection.tools.count == 1)
    let tool = projection.tools[0]
    precondition(tool.state == .completed && tool.providerToolName == "Read")
    precondition(tool.input?.objectValue?["path"]?.stringValue == "src/example.ts")
    precondition(tool.output?.stringValue == "file contents")
    if name == "ordinary" {
        precondition(tool.id == "ordinary")
        precondition(tool.parentToolUseID == "parent" && tool.parentAgentID == "agent1")
    } else {
        precondition(tool.id == "visible")
        let hiddenUses = blocks.filter { $0.kind == "tool_use" && $0.payload?["tool_use_id"]?.stringValue != "visible" }
        precondition(hiddenUses.count == 3)
        let flag = name == "hidden" ? "hidden_from_transcript" : "hidden_from_activity"
        precondition(hiddenUses.allSatisfy { $0.payload?[flag]?.boolValue == true })
    }
    precondition(blocks.filter { $0.kind == "tool_use" }.allSatisfy {
        $0.payload?["display_name"] == nil && $0.payload?["server_display_name"] == nil && $0.payload?["icon_url"] == nil
    })
    let body = chatBody(message)
    precondition(body.count == 1 && body[0].kind == .markdown && body[0].text == "Assistant answer")
}
print("Durable tool Activity passed: ordinary, hidden, ambient, Chat body")
