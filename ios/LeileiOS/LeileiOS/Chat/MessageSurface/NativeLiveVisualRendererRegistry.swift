import Foundation

// The sole rendering authority. F kinds remain explicit fail-visible fallbacks.
enum NativeLiveMessageRendererRegistry {
    enum Renderer: Equatable { case markdown, code, table, diff, math, mathVisual, mermaid, attachment, svgAttachment, structuredResult, structuredJSON, searchResult, citation, fallback }

    static func renderer(for kind: NativeLiveVisualNodeKind) -> Renderer {
        switch kind {
        case .text, .markdown: return .markdown
        case .code: return .code
        case .table: return .table
        case .diff: return .diff
        case .math: return .math
        case .mermaid: return .mermaid
        case .attachment: return .attachment
        case .canonicalToolResult: return .structuredResult
        case .structuredJSON: return .structuredJSON
        case .searchResult: return .searchResult
        case .citation: return .citation
        case .artifact, .resource, .unknown, .image, .gallery, .file, .document, .svg, .chart, .diagram, .webArtifact, .interactiveResource: return .fallback
        }
    }

    static func renderer(for input: NativeLiveAttachmentPresentationInput) -> Renderer {
        input.mediaKind == .svg ? .svgAttachment : .attachment
    }

    static func renderer(for node: NativeLiveVisualNode) -> Renderer {
        // Media renderer owns explicit materialization/error states, including drafts.
        if node.kind == .attachment {
            guard let input = node.attachment else { return .fallback }
            if input.entityID?.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty == true { return .fallback }
            return renderer(for: input)
        }
        if node.kind == .math, node.math?.isDisplay == true { return .mathVisual }
        return renderer(for: node.kind)
    }
}
