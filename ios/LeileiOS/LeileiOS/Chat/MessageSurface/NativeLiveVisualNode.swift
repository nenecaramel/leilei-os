import Foundation

enum NativeLiveVisualNodeKind: String, CaseIterable, Sendable {
    case text, markdown, attachment, artifact, resource, canonicalToolResult = "canonical_tool_result", unknown
    case structuredJSON = "structured_json"
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
    var kind: NativeLiveVisualNodeKind
    var text: String?
    let sourceBlock: NativeLiveCurrentPathBlock
    var attachment: NativeLiveAttachmentPresentationInput?
    var fallback: NativeLiveVisualFallback

    var rendersInlineChildren = false
    var sourceRangeUTF16: Range<Int>? = nil
    var markdown: NativeLiveMarkdownPresentation? = nil
    var code: NativeLiveCodePresentation? = nil
    var table: NativeLiveTablePresentation? = nil
    var diff: NativeLiveDiffPresentation? = nil
    var math: NativeLiveMathPresentation? = nil
    var presentationID: String? = nil
    var children: [NativeLiveVisualNode] = []
    var structuredStatus: NativeLiveStructuredResultStatus? = nil
    var json: NativeLiveStructuredJSON? = nil
    var search: NativeLiveSearchResultPresentation? = nil
    var citations: [NativeLiveCitationRelation] = []
    var citationSourcesToRender: [NativeLiveCitationSource]? = nil
    var partProvenance: NativeLiveJSONValue? = nil
    var id: String { presentationID ?? sourceBlock.id }
    var ordinal: Int { sourceBlock.ordinal }
    var canonicalIdentity: String { sourceBlock.kind }
    var rawType: String { sourceBlock.rawType }
    var provenance: NativeLiveJSONValue? { partProvenance ?? sourceBlock.payload?["provenance"] }
    var entityRefs: [NativeLiveJSONValue] { sourceBlock.payload?["refs"]?.arrayValue ?? [] }
    var materialization: String? { attachment?.materialization ?? sourceBlock.payload?["materialization"]?.stringValue }
    var inputMode: String? { sourceBlock.payload?["input_mode"]?.stringValue }
}
