import Foundation

struct NativeLiveAttachmentPresentationInput: Equatable, Sendable {
    let entityID: String?
    let draftID: String
    let filename: String
    let mimeType: String
    let kind: String
    let materialization: String

    var retainedComposerDraft: NativeLiveComposerAttachmentDraft? {
        guard let entityID, !entityID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return .init(existingAttachmentID: entityID, filename: filename, mimeType: mimeType,
                     kind: kind == "image" ? .image : .file)
    }

    var blockPayload: [String: NativeLiveJSONValue] {
        var payload: [String: NativeLiveJSONValue] = [
            "filename": .string(filename), "mime_type": .string(mimeType),
            "kind": .string(kind), "materialization": .string(materialization)
        ]
        if let entityID {
            payload["attachment_id"] = .string(entityID)
            payload["refs"] = .array([.object(["type": .string("attachment_ref"), "entity_id": .string(entityID)])])
        }
        return payload
    }

    init(entityID: String?, draftID: String, filename: String, mimeType: String, kind: String, materialization: String) {
        self.entityID = entityID; self.draftID = draftID; self.filename = filename
        self.mimeType = mimeType; self.kind = kind; self.materialization = materialization
    }

    init(block: NativeLiveCurrentPathBlock) {
        let payload = block.payload ?? [:]
        entityID = payload["attachment_id"]?.stringValue ?? payload["refs"]?.arrayValue?.first(where: {
            $0.objectValue?["type"]?.stringValue == "attachment_ref"
        })?.objectValue?["entity_id"]?.stringValue
        draftID = block.id
        filename = payload["filename"]?.stringValue ?? "Attachment"
        mimeType = payload["mime_type"]?.stringValue ?? "application/octet-stream"
        kind = payload["kind"]?.stringValue ?? "file"
        materialization = payload["materialization"]?.stringValue ?? (entityID == nil ? "pending" : "ready")
    }
}

extension NativeLiveComposerAttachmentDraft {
    var presentationInput: NativeLiveAttachmentPresentationInput {
        let materialization: String
        switch state {
        case .uploading: materialization = "uploading"
        case .ready: materialization = "ready"
        case .failed: materialization = "failed"
        }
        return .init(entityID: remoteAttachmentID, draftID: id.uuidString,
                     filename: filename, mimeType: mimeType, kind: kind.rawValue,
                     materialization: materialization)
    }
}

// These block values are presentation input descriptors, never canonical writes.
struct NativeLiveMessagePresentationSource: Equatable, Sendable {
    enum Phase: Equatable, Sendable { case canonical, externalHistory, pendingSend, pendingEdit }
    let messageID: String
    let role: String
    let blocks: [NativeLiveCurrentPathBlock]
    let phase: Phase

    static func canonical(_ message: NativeLiveCurrentPathMessage) -> Self {
        .init(messageID: message.id, role: message.role, blocks: message.blocks, phase: .canonical)
    }

    // External history contains text only; this adapter does not manufacture ledger rows.
    static func history(_ message: NativeLiveConversationHistoryMessage) -> Self {
        .init(messageID: "history:\(message.ordinal)", role: message.role,
              blocks: [.init(id: "history:\(message.ordinal):text", ordinal: 0, kind: "text",
                             rawType: "text", text: message.content, payload: nil, createdAt: message.time)],
              phase: .externalHistory)
    }

    static func send(messageID: String, text: String, attachments: [NativeLiveAttachmentPresentationInput] = [], inputMode: NativeLiveInputMode = .text) -> Self {
        var blocks = [NativeLiveCurrentPathBlock]()
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            blocks.append(.init(id: "\(messageID):text", ordinal: 0, kind: "text", rawType: "text", text: text,
                                payload: inputMode == .voice ? ["input_mode": .string("voice")] : nil, createdAt: ""))
        }
        let attachmentStart = blocks.count
        blocks += attachments.enumerated().map { index, attachment in
            attachmentBlock(attachment, ordinal: index + attachmentStart)
        }
        return .init(messageID: messageID, role: "user", blocks: blocks, phase: .pendingSend)
    }

    static func edit(_ message: NativeLiveCurrentPathMessage, text: String, attachments: [NativeLiveAttachmentPresentationInput]? = nil) -> Self {
        let firstText = message.blocks.enumerated().filter { $0.element.kind == "text" }.min {
            $0.element.ordinal == $1.element.ordinal ? $0.offset < $1.offset : $0.element.ordinal < $1.element.ordinal
        }?.element
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let originals = message.blocks.enumerated().filter { $0.element.kind == "attachment" }.sorted {
            $0.element.ordinal == $1.element.ordinal ? $0.offset < $1.offset : $0.element.ordinal < $1.element.ordinal
        }.map(\.element)
        let selected = attachments ?? originals.map { NativeLiveAttachmentPresentationInput(block: $0) }
        var blocks = message.blocks.filter { $0.kind != "text" && $0.kind != "attachment" }
        if hasText {
            blocks.append(.init(id: firstText?.id ?? "\(message.id):text", ordinal: 0,
                                kind: "text", rawType: "text", text: text, payload: nil, createdAt: firstText?.createdAt ?? ""))
        }
        // Edit creates a text-first canonical message. Retain attachment identity and
        // metadata while matching the backend's resulting ordinals, including text removal.
        for (index, attachment) in selected.enumerated() {
            let ordinal = index + (hasText ? 1 : 0)
            if let retained = originals.first(where: {
                let input = NativeLiveAttachmentPresentationInput(block: $0)
                return attachment.entityID != nil && input.entityID == attachment.entityID
            }) {
                blocks.append(.init(id: retained.id, ordinal: ordinal, kind: retained.kind,
                                    rawType: retained.rawType, text: retained.text,
                                    payload: retained.payload, createdAt: retained.createdAt))
            } else {
                blocks.append(attachmentBlock(attachment, ordinal: ordinal))
            }
        }
        return .init(messageID: message.id, role: message.role, blocks: blocks, phase: .pendingEdit)
    }

    private static func attachmentBlock(_ attachment: NativeLiveAttachmentPresentationInput, ordinal: Int) -> NativeLiveCurrentPathBlock {
        .init(id: "attachment:\(attachment.entityID ?? attachment.draftID)", ordinal: ordinal,
              kind: "attachment", rawType: attachment.kind, text: nil, payload: attachment.blockPayload, createdAt: "")
    }
}

struct NativeLiveMessagePresentation: Equatable, Sendable {
    let messageID: String
    let role: String
    let nodes: [NativeLiveVisualNode]

    var copyText: String? {
        let text = nodes.filter { $0.canonicalIdentity == "text" }.compactMap(\.text).joined(separator: "\n\n")
        return text.isEmpty ? nil : text
    }
    var attachmentInputs: [NativeLiveAttachmentPresentationInput] { nodes.compactMap(\.attachment) }
    var collapsedVoiceNodes: [NativeLiveVisualNode] { nodes.filter { $0.canonicalIdentity != "text" } }
    var isVoiceInput: Bool {
        role == "user" && nodes.contains { $0.canonicalIdentity == "text" && $0.inputMode == "voice" }
    }
}
