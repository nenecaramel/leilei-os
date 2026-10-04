import Foundation

struct NativeLivePendingOperation: Equatable {
    enum Kind: Equatable {
        case send(text: String)
        case retry(targetUserMessageID: String)
        case edit(targetUserMessageID: String, text: String)
    }

    let id: UUID
    var isDraftConversation = false
    var startedAt = ISO8601DateFormatter().string(from: Date())
    let kind: Kind
    let baselineSyncToken: String?
    let presentationAttachments: [NativeLiveAttachmentPresentationInput]
    let inputMode: NativeLiveInputMode

    init(
        kind: Kind,
        baselineSyncToken: String?,
        presentationAttachments: [NativeLiveAttachmentPresentationInput] = [],
        inputMode: NativeLiveInputMode = .text
    ) {
        self.id = UUID()
        self.kind = kind
        self.baselineSyncToken = baselineSyncToken
        self.presentationAttachments = presentationAttachments
        self.inputMode = inputMode
    }

    private init(
        id: UUID,
        kind: Kind,
        baselineSyncToken: String?,
        presentationAttachments: [NativeLiveAttachmentPresentationInput],
        inputMode: NativeLiveInputMode
    ) {
        self.id = id
        self.kind = kind
        self.baselineSyncToken = baselineSyncToken
        self.presentationAttachments = presentationAttachments
        self.inputMode = inputMode
    }

    func rebased(
        to syncToken: String?
    ) -> NativeLivePendingOperation {
        var result = NativeLivePendingOperation(
            id: id,
            kind: kind,
            baselineSyncToken: syncToken,
            presentationAttachments: presentationAttachments,
            inputMode: inputMode
        )
        result.isDraftConversation = syncToken == nil && isDraftConversation
        result.startedAt = startedAt
        return result
    }

    var targetUserMessageID: String? {
        switch kind {
        case .send:
            return nil
        case .retry(let targetUserMessageID):
            return targetUserMessageID
        case .edit(let targetUserMessageID, _):
            return targetUserMessageID
        }
    }

    var editedText: String? {
        guard case .edit(_, let text) = kind else {
            return nil
        }
        return text
    }

    var sendText: String? {
        guard case .send(let text) = kind else {
            return nil
        }
        return text
    }

    var isSend: Bool {
        if case .send = kind {
            return true
        }
        return false
    }
}
