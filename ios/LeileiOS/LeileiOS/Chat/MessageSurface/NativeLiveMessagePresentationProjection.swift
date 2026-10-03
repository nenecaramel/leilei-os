import Foundation

enum NativeLiveMessagePresentationProjector {
    static func project(_ source: NativeLiveMessagePresentationSource) -> NativeLiveMessagePresentation {
        let ordered = source.blocks.enumerated().sorted {
            $0.element.ordinal == $1.element.ordinal ? $0.offset < $1.offset : $0.element.ordinal < $1.element.ordinal
        }
        let nodes: [NativeLiveVisualNode] = ordered.compactMap { _, block in
            // Activity reads original ledger rows independently of Chat projection.
            if block.kind == "tool_use" || block.kind == "tool_result" { return nil }
            let kind: NativeLiveVisualNodeKind
            var text: String?
            switch block.kind {
            case "text":
                guard let value = normalizedText(block.text) else { return nil }
                text = value; kind = .markdown
            case "attachment": kind = .attachment
            case "artifact": kind = .artifact
            case "resource": kind = .resource
            case "canonical_tool_result": kind = .canonicalToolResult
            default: kind = .unknown
            }
            let attachment = kind == .attachment ? NativeLiveAttachmentPresentationInput(block: block) : nil
            return .init(kind: kind, text: text, sourceBlock: block, attachment: attachment,
                         fallback: fallback(block, attachment: attachment))
        }
        return .init(messageID: source.messageID, role: source.role, nodes: nodes)
    }

    private static func normalizedText(_ text: String?) -> String? {
        guard let text else { return nil }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private static func fallback(_ block: NativeLiveCurrentPathBlock, attachment: NativeLiveAttachmentPresentationInput?) -> NativeLiveVisualFallback {
        var metadata = [String: String]()
        // Whitelist scalar descriptors; never stringify compatibility or provider payloads.
        for key in ["filename", "mime_type", "size_bytes", "materialization", "stored_kind"] {
            if let value = block.payload?[key]?.stringValue { metadata[key] = String(value.prefix(180)) }
            else if let value = block.payload?[key]?.numberValue, value.isFinite { metadata[key] = String(value) }
        }
        if let attachment { metadata["materialization"] = String(attachment.materialization.prefix(180)) }
        return .init(title: String((attachment == nil ? "Unsupported content" : (attachment?.filename ?? "Attachment")).prefix(180)),
                     rawType: String(block.rawType.prefix(180)),
                     diagnostic: String((block.payload?["diagnostic_code"]?.stringValue ?? (attachment == nil ? "RENDERER_UNAVAILABLE" : "ATTACHMENT_\(attachment!.materialization.uppercased())")).prefix(180)),
                     metadata: metadata)
    }
}
