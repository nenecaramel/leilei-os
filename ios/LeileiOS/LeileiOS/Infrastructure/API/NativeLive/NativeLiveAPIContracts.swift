import Foundation

struct NativeLiveExternalSessionRequestEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveExternalSessionRequestSnapshot
}

struct NativeLiveManualCompactEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveManualCompactSnapshot
}

struct NativeLiveConversationRuntimeMetadataEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveConversationRuntimeMetadataSnapshot
}

struct NativeLiveConversationListEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ConversationListData

    struct ConversationListData: Decodable, Sendable {
        let conversations: [NativeLiveConversationSummary]
        let nextCursor: String?
    }
}

struct NativeLiveConversationEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveConversationSummary
}

struct NativeLiveConversationHistoryEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveConversationHistorySnapshot
}

struct CreateNativeLiveConversationFromClaudeSessionBody:
    Encodable,
    Sendable {
    let requestID: String
    let sourceSessionID: String
    let title: String?
    let historySnapshot: NativeLiveConversationHistoryUpload?

    enum CodingKeys: String, CodingKey {
        case requestID = "request_id"
        case sourceSessionID = "source_session_id"
        case title
        case historySnapshot = "history_snapshot"
    }
}

struct CreateNativeLiveConversationBody: Encodable, Sendable {
    let title: String?
}

struct RenameNativeLiveConversationBody: Encodable, Sendable {
    let title: String
}

struct NativeLivePrepareEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLivePrepareResult
}

struct NativeLiveActiveTurnEnvelope: Decodable, Sendable {
    let success: Bool
    let data: ActiveTurnData

    struct ActiveTurnData: Decodable, Sendable {
        let turn: NativeLiveTurnSnapshot?
    }
}

struct NativeLiveTurnWaitEnvelope: Decodable, Sendable {
    let success: Bool
    let data: WaitData

    struct WaitData: Decodable, Sendable {
        let outcome: String
        let turn: NativeLiveTurnSnapshot?
    }
}

struct NativeLiveRuntimeControlCreateBody:
    Encodable,
    Sendable {
    let controlID: String
    let kind: String
    let payload: [String: NativeLiveJSONValue]

    enum CodingKeys: String, CodingKey {
        case controlID = "control_id"
        case kind
        case payload
    }
}

struct NativeLiveRuntimeControlCreateEnvelope:
    Decodable,
    Sendable {
    struct ControlData: Decodable, Sendable {
        let outcome: String
        let control: NativeLiveRuntimeControlSnapshot
    }

    let success: Bool
    let data: ControlData
}

struct NativeLiveRuntimeInteractionResponseBody:
    Encodable,
    Sendable {
    let response: [String: NativeLiveJSONValue]
}

struct NativeLiveRuntimeInteractionResolveEnvelope:
    Decodable,
    Sendable {
    struct ResolveData: Decodable, Sendable {
        let outcome: String
        let interaction: NativeLiveRuntimeInteractionSnapshot
    }

    let success: Bool
    let data: ResolveData
}

struct NativeLiveRuntimeEventsEnvelope:
    Decodable,
    Sendable {
    struct EventData: Decodable, Sendable {
        let prepareID: String
        let events: [NativeLiveRuntimeEventSnapshot]
        let nextAfterSequence: Int

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case events
            case nextAfterSequence
        }
    }

    let success: Bool
    let data: EventData
}

struct NativeLiveRuntimeInteractionsEnvelope:
    Decodable,
    Sendable {
    struct InteractionData: Decodable, Sendable {
        let prepareID: String
        let interactions: [NativeLiveRuntimeInteractionSnapshot]

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case interactions
        }
    }

    let success: Bool
    let data: InteractionData
}

struct NativeLiveRuntimeControlsEnvelope:
    Decodable,
    Sendable {
    struct ControlData: Decodable, Sendable {
        let prepareID: String
        let controls: [NativeLiveRuntimeControlSnapshot]

        enum CodingKeys: String, CodingKey {
            case prepareID = "prepareId"
            case controls
        }
    }

    let success: Bool
    let data: ControlData
}

struct NativeLiveAttachmentUploadSlotBody:
    Encodable,
    Sendable {
    let filename: String
    let mimeType: String
    let sizeBytes: Int
    let sha256: String
    let kind: NativeLiveComposerAttachmentKind

    enum CodingKeys: String, CodingKey {
        case filename
        case mimeType = "mime_type"
        case sizeBytes = "size_bytes"
        case sha256
        case kind
    }
}

struct NativeLiveAttachmentUploadSlotEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveAttachmentUploadSlot
}

struct NativeLiveAttachmentCompleteEnvelope:
    Decodable,
    Sendable {
    struct CompleteData: Decodable, Sendable {
        let attachment: NativeLiveChatAttachmentSnapshot
    }

    let success: Bool
    let data: CompleteData
}

struct NativeLiveAttachmentDownloadSlotEnvelope:
    Decodable,
    Sendable {
    let success: Bool
    let data: NativeLiveAttachmentDownloadSlot
}

struct NativeLiveSendBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let expectedHeadMessageId: String?
    let text: String
    let attachmentIds: [String]
    let execution: NativeLiveExecutionSelection?
    var inputMode: NativeLiveInputMode = .text

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case expectedHeadMessageId = "expected_head_message_id"
        case text
        case attachmentIds = "attachment_ids"
        case inputMode = "input_mode"
        case execution
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(dispatchTarget, forKey: .dispatchTarget)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(operation, forKey: .operation)
        try container.encode(conversationId, forKey: .conversationId)
        if let expectedHeadMessageId {
            try container.encode(
                expectedHeadMessageId,
                forKey: .expectedHeadMessageId
            )
        } else {
            try container.encodeNil(forKey: .expectedHeadMessageId)
        }
        try container.encode(text, forKey: .text)
        if !attachmentIds.isEmpty {
            try container.encode(
                attachmentIds,
                forKey: .attachmentIds
            )
        }
        try container.encodeIfPresent(execution, forKey: .execution)
        if inputMode == .voice {
            try container.encode(inputMode.rawValue, forKey: .inputMode)
        }
    }
}

struct NativeLiveRetryBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let targetUserMessageId: String
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case targetUserMessageId = "target_user_message_id"
        case execution
    }
}

struct NativeLiveEditBody: Encodable, Sendable {
    let dispatchTarget: String
    let requestId: String
    let operation: String
    let conversationId: String
    let targetUserMessageId: String
    let text: String
    let attachmentIds: [String]?
    let execution: NativeLiveExecutionSelection?

    enum CodingKeys: String, CodingKey {
        case dispatchTarget = "dispatch_target"
        case requestId = "request_id"
        case operation
        case conversationId = "conversation_id"
        case targetUserMessageId = "target_user_message_id"
        case text
        case attachmentIds = "attachment_ids"
        case execution
    }
}

struct NativeLiveCurrentPathEnvelope: Decodable, Sendable {
    let success: Bool
    let data: NativeLiveCurrentPathSnapshot
}

struct NativeLiveConversationHeadWaitBody: Encodable {
    let afterHeadMessageID: String?

    enum CodingKeys: String, CodingKey {
        case afterHeadMessageID = "after_head_message_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(
            keyedBy: CodingKeys.self
        )
        if let afterHeadMessageID {
            try container.encode(
                afterHeadMessageID,
                forKey: .afterHeadMessageID
            )
        } else {
            try container.encodeNil(
                forKey: .afterHeadMessageID
            )
        }
    }
}
