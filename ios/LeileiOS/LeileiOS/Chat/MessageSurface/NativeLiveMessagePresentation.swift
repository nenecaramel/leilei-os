import Foundation
import CryptoKit

struct NativeLiveAttachmentPresentationInput: Equatable, Sendable {
    let entityID: String?
    let draftID: String
    let filename: String
    let mimeType: String
    let kind: String
    let materialization: String
    let metadata: [String: NativeLiveJSONValue]
    let source: NativeLiveAttachmentSource

    var retainedComposerDraft: NativeLiveComposerAttachmentDraft? {
        guard presentationState == .ready || presentationState == .loaded,
              let entityID, !entityID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        var draft = NativeLiveComposerAttachmentDraft(existingAttachmentID: entityID, filename: filename, mimeType: mimeType,
                     kind: kind == "image" ? .image : .file)
        draft.presentationMetadata = metadata
        return draft
    }

    var blockPayload: [String: NativeLiveJSONValue] {
        var payload = metadata
        payload.merge([
            "filename": .string(filename), "mime_type": .string(mimeType),
            "kind": .string(kind), "materialization": .string(materialization)
        ]) { _, updated in updated }
        if let entityID {
            payload["attachment_id"] = .string(entityID)
            if payload["refs"] == nil { payload["refs"] = .array([.object(["type": .string("attachment_ref"), "entity_id": .string(entityID)])]) }
        }
        return payload
    }

    init(entityID: String?, draftID: String, filename: String, mimeType: String, kind: String, materialization: String, metadata: [String: NativeLiveJSONValue] = [:], source: NativeLiveAttachmentSource = .draft) {
        self.entityID = entityID; self.draftID = draftID; self.filename = filename
        self.mimeType = mimeType; self.kind = kind; self.materialization = materialization
        self.metadata = metadata; self.source = source
    }

    init(block: NativeLiveCurrentPathBlock, source: NativeLiveAttachmentSource = .authoritative) {
        let payload = block.payload ?? [:]
        metadata = payload
        self.source = source
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
        let metadata = presentationMetadata
        return .init(entityID: remoteAttachmentID, draftID: id.uuidString,
                     filename: filename, mimeType: mimeType, kind: kind.rawValue,
                     materialization: materialization, metadata: metadata, source: data == nil && remoteAttachmentID != nil ? .retainedEdit : .draft)
    }
}

// These block values are presentation input descriptors, never canonical writes.
struct NativeLiveMessagePresentationSource: Equatable, Sendable {
    enum Phase: Equatable, Sendable { case canonical, externalHistory, runtimeStreaming, pendingSend, pendingEdit }
    let messageID: String
    let role: String
    let blocks: [NativeLiveCurrentPathBlock]
    let phase: Phase
    // Draft provenance belongs to presentation context, never canonical payload.
    var attachmentSources: [String: NativeLiveAttachmentSource] = [:]

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

    // Ephemeral text descriptor; the runtime never writes Markdown children to the ledger.
    static func streaming(_ text: String) -> Self {
        .init(messageID: "runtime-streaming", role: "assistant",
              blocks: [.init(id: "runtime-streaming:text", ordinal: 0, kind: "text", rawType: "text",
                             text: text, payload: nil, createdAt: "")], phase: .runtimeStreaming)
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
        var result = Self(messageID: messageID, role: "user", blocks: blocks, phase: .pendingSend)
        for attachment in attachments {
            result.attachmentSources[attachmentBlock(attachment, ordinal: 0).id] = attachment.source
        }
        return result
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
        var attachmentSources: [String: NativeLiveAttachmentSource] = [:]
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
                attachmentSources[retained.id] = .retainedEdit
            } else {
                let block = attachmentBlock(attachment, ordinal: ordinal)
                blocks.append(block)
                attachmentSources[block.id] = attachment.source
            }
        }
        return .init(messageID: message.id, role: message.role, blocks: blocks, phase: .pendingEdit, attachmentSources: attachmentSources)
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
