import Foundation

@main struct CurrentPathChecks {
    static func message(_ id: String, parent: String? = nil, text: String = "old") -> NativeLiveCurrentPathMessage {
        .init(id: id, conversationId: "conversation", parentMessageId: parent, role: "assistant", status: "completed", createdAt: "date", completedAt: nil,
              blocks: [.init(id: id + "-block", ordinal: 0, kind: "text", rawType: "text", text: text, payload: nil, createdAt: "date")])
    }
    static func snapshot(_ messages: [NativeLiveCurrentPathMessage], token: String = "old", truncated: Bool = true, cursor: String? = "older", failure: NativeLiveFailedTurnSnapshot? = nil) -> NativeLiveCurrentPathSnapshot {
        .init(conversationId: "conversation-" + token, title: token, currentHeadMessageId: messages.last?.id, updatedAt: "date-" + token, syncToken: token, truncated: truncated, olderCursor: cursor, resetRequired: false, messages: messages, failedTurn: failure)
    }
    static func main() {
        let a = message("a"), b = message("b", parent: "a"), c = message("c", parent: "b")
        let failure = NativeLiveFailedTurnSnapshot(prepareId: "p", requestId: "r", conversationId: "conversation", operation: "send", userMessageId: "u", preparedUserMessage: message("u"), replacementTargetUserMessageId: nil, anchorHeadMessageId: "c", startedAt: "start", failureCode: "failure", events: [], interactions: [])
        let old = snapshot([a, b, c])
        let refreshed = snapshot([message("b", parent: "a", text: "updated"), c], token: "new", truncated: false, cursor: nil, failure: failure)
        let merged = NativeLiveCurrentPathTransforms.mergeNativeLiveRefresh(existing: old, refreshed: refreshed)
        precondition(merged == snapshot([a] + refreshed.messages, token: "new", failure: failure))
        // Parent anchor retains history even when first refreshed message has a new ID.
        let branch = snapshot([message("new", parent: "b")], token: "branch")
        precondition(NativeLiveCurrentPathTransforms.mergeNativeLiveRefresh(existing: old, refreshed: branch).messages == [a, b] + branch.messages)
        for replacement in [snapshot([]), snapshot([message("unknown")]), snapshot([a], token: "first")] {
            precondition(NativeLiveCurrentPathTransforms.mergeNativeLiveRefresh(existing: old, refreshed: replacement) == replacement)
        }
        let delta = snapshot([b, message("d", parent: "c"), message("e", parent: "d")], token: "delta", truncated: false, cursor: nil, failure: failure)
        precondition(NativeLiveCurrentPathTransforms.mergeNativeLiveDelta(existing: old, delta: delta) == snapshot([a,b,c] + Array(delta.messages.dropFirst()), token: "delta", failure: failure))
        let empty = snapshot([], token: "empty", truncated: false, cursor: nil)
        let emptyMerged = NativeLiveCurrentPathTransforms.mergeNativeLiveDelta(existing: old, delta: empty)
        precondition(emptyMerged.messages == [a,b,c] && emptyMerged.currentHeadMessageId == nil && emptyMerged.syncToken == "empty" && emptyMerged.olderCursor == old.olderCursor && emptyMerged.failedTurn == nil)
        let initial = NativeLiveCurrentPathTransforms.mergeNativeLiveDelta(existing: snapshot([], truncated: false, cursor: nil), delta: delta)
        precondition(initial == delta)
        // Incoming duplicate behavior is deliberately conserved: only existing IDs are filtered.
        let repeated = snapshot([message("d"), message("d")])
        precondition(NativeLiveCurrentPathTransforms.mergeNativeLiveDelta(existing: old, delta: repeated).messages.map(\.id) == ["a","b","c","d","d"])
        precondition(old.messages == [a,b,c] && old.syncToken == "old")
        print("Current path transforms PASS")
    }
}
