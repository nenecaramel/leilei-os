import Foundation

enum NativeLiveVisualNodeKind: String, CaseIterable, Sendable {
    case text, markdown, attachment, artifact, resource, canonicalToolResult = "canonical_tool_result", unknown
    case code, table, diff, math, citation, searchResult = "search_result"
    case image, gallery, file, document, mermaid, svg, chart, diagram
    case webArtifact = "web_artifact", interactiveResource = "interactive_resource"
}

struct NativeLiveVisualFallback: Equatable, Sendable {
    let title: String
    let rawType: String
    let diagnostic: String
    let metadata: [String: String]
}

struct NativeLiveVisualNode: Identifiable, Equatable, Sendable {
    let kind: NativeLiveVisualNodeKind
    let text: String?
    let sourceBlock: NativeLiveCurrentPathBlock
    let attachment: NativeLiveAttachmentPresentationInput?
    let fallback: NativeLiveVisualFallback

    var id: String { sourceBlock.id }
    var ordinal: Int { sourceBlock.ordinal }
    var canonicalIdentity: String { sourceBlock.kind }
    var rawType: String { sourceBlock.rawType }
    var provenance: NativeLiveJSONValue? { sourceBlock.payload?["provenance"] }
    var entityRefs: [NativeLiveJSONValue] { sourceBlock.payload?["refs"]?.arrayValue ?? [] }
    var materialization: String? { attachment?.materialization ?? sourceBlock.payload?["materialization"]?.stringValue }
    var inputMode: String? { sourceBlock.payload?["input_mode"]?.stringValue }
}

// G will extend renderer registration. B registers only existing rendering and fallback.
enum NativeLiveMessageRendererRegistry {
    enum Renderer: Equatable { case markdown, attachment, fallback }

    static func renderer(for kind: NativeLiveVisualNodeKind) -> Renderer {
        switch kind {
        case .text, .markdown: return .markdown
        case .attachment: return .attachment
        default: return .fallback
        }
    }

    static func renderer(for node: NativeLiveVisualNode) -> Renderer {
        // Media renderer owns explicit materialization/error states, including drafts.
        if node.kind == .attachment {
            guard let input = node.attachment else { return .fallback }
            if input.entityID?.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty == true { return .fallback }
            return .attachment
        }
        return renderer(for: node.kind)
    }
}
