import Foundation

@main struct NativeLiveContractChecks {
    static func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as! [String: Any]
    }
    static func main() throws {
        let ordinary = try object(NativeLiveSendBody(dispatchTarget: "claude_code", requestId: "r", operation: "send", conversationId: "c", expectedHeadMessageId: nil, text: "中文", attachmentIds: [], execution: nil))
        precondition(Set(ordinary.keys) == Set(["dispatch_target","request_id","operation","conversation_id","expected_head_message_id","text"]))
        precondition(ordinary["expected_head_message_id"] is NSNull && ordinary["text"] as? String == "中文")
        let execution = NativeLiveExecutionSelection(model: .sonnet55, thinking: .adaptive, effort: .high)
        let voice = try object(NativeLiveSendBody(dispatchTarget: "claude_code", requestId: "r", operation: "send", conversationId: "c", expectedHeadMessageId: "head", text: "", attachmentIds: ["a", "b"], execution: execution, inputMode: .voice))
        precondition(voice["input_mode"] as? String == "voice" && voice["expected_head_message_id"] as? String == "head")
        precondition(voice["attachment_ids"] as? [String] == ["a", "b"])
        let selection = voice["execution"] as! [String:String]
        precondition(selection == ["model":"claude-sonnet-5-5","thinking":"adaptive","effort":"high"])
        let retry = try object(NativeLiveRetryBody(dispatchTarget: "claude_code", requestId: "r", operation: "retry", conversationId: "c", targetUserMessageId: "u", execution: nil))
        precondition(Set(retry.keys) == Set(["dispatch_target","request_id","operation","conversation_id","target_user_message_id"]))
        precondition(retry["target_user_message_id"] as? String == "u")
        for attachments: [String]? in [nil, [], ["a"]] {
            let edit = try object(NativeLiveEditBody(dispatchTarget: "claude_code", requestId: "r", operation: "edit", conversationId: "c", targetUserMessageId: "u", text: "edited", attachmentIds: attachments, execution: execution))
            precondition(edit["text"] as? String == "edited" && edit["target_user_message_id"] as? String == "u")
            if let attachments { precondition(edit["attachment_ids"] as? [String] == attachments) }
            else { precondition(edit["attachment_ids"] == nil) }
        }
        let emptyHead = try object(NativeLiveConversationHeadWaitBody(afterHeadMessageID: nil))
        precondition(emptyHead.count == 1 && emptyHead["after_head_message_id"] is NSNull)
        let head = try object(NativeLiveConversationHeadWaitBody(afterHeadMessageID: "h"))
        precondition(head["after_head_message_id"] as? String == "h")
        let slot = try object(NativeLiveAttachmentUploadSlotBody(filename: "file.png", mimeType: "image/png", sizeBytes: 3, sha256: "hash", kind: .image))
        precondition(Set(slot.keys) == Set(["filename","mime_type","size_bytes","sha256","kind"]))
        let control = try object(NativeLiveRuntimeControlCreateBody(controlID: "ctl", kind: "interrupt", payload: [:]))
        precondition(control["control_id"] as? String == "ctl" && control["payload"] is [String:Any])
        let external = try object(CreateNativeLiveConversationFromClaudeSessionBody(requestID: "r", sourceSessionID: "s", title: nil, historySnapshot: nil))
        precondition(Set(external.keys) == Set(["request_id","source_session_id"]))
        let response = try JSONDecoder().decode(NativeLiveCurrentPathEnvelope.self, from: Data(#"{"success":true,"data":{"conversationId":"c","title":null,"currentHeadMessageId":null,"updatedAt":"date","syncToken":"token","truncated":false,"olderCursor":null,"resetRequired":false,"messages":[]}}"#.utf8))
        precondition(response.success && response.data.syncToken == "token" && response.data.messages.isEmpty)
        let events = try JSONDecoder().decode(NativeLiveRuntimeEventsEnvelope.self, from: Data(#"{"success":true,"data":{"prepareId":"p","events":[],"nextAfterSequence":7}}"#.utf8))
        precondition(events.data.prepareID == "p" && events.data.nextAfterSequence == 7)
        let interactions = try JSONDecoder().decode(NativeLiveRuntimeInteractionsEnvelope.self, from: Data(#"{"success":true,"data":{"prepareId":"p","interactions":[]}}"#.utf8))
        let controls = try JSONDecoder().decode(NativeLiveRuntimeControlsEnvelope.self, from: Data(#"{"success":true,"data":{"prepareId":"p","controls":[]}}"#.utf8))
        precondition(interactions.data.prepareID == "p" && controls.data.prepareID == "p")
        print("Native Live contracts PASS")
    }
}
