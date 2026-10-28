import SwiftUI
import Foundation

struct NativeLiveMessagePresentationView: View {
    let presentation: NativeLiveMessagePresentation

    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            NativeLiveVisualNodesView(nodes: presentation.renderNodes, role: presentation.role)
            NativeLiveCitationSourcesView(sources:presentation.citationSources)
        }
    }
}



struct NativeLiveVisualNodesView: View {
    let nodes: [NativeLiveVisualNode]
    let role: String

    var body: some View {
        VStack(alignment: .leading, spacing: role == "user" ? 19 : 22) {
            ForEach(nodes) { node in
                NativeLiveVisualNodeView(node: node, role: role)
            }
        }
    }
}

struct NativeLiveVisualNodeView: View {
    let node: NativeLiveVisualNode
    let role: String

    @ViewBuilder var body: some View {
        switch NativeLiveMessageRendererRegistry.renderer(for: node) {
        case .markdown:
            if node.rendersInlineChildren, let model = node.markdown {
                NativeLiveInlineMathParagraphRenderer(
                    node: node,
                    model: model,
                    role: role
                )
                .contextMenu {
                    ForEach(node.children.filter { $0.math != nil }) { child in
                        Button("Copy math: \(String((child.math?.latex ?? "").prefix(30)))") {
                            UIPasteboard.general.string = child.math?.latex
                        }
                    }
                }
            } else if !node.children.isEmpty {
                NativeLiveVisualNodesView(nodes: node.children, role: role)
            } else if let model = node.markdown {
                NativeLiveMarkdownRenderer(model: model, role: role)
            } else if let text = node.text {
                // Unprojected future text stays visible without another parser authority.
                Text(text).textSelection(.enabled)
            } else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .code:
            if let model = node.code { NativeLiveCodeRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .table:
            if let model = node.table { NativeLiveTableRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .diff:
            if let model = node.diff { NativeLiveDiffRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .mathVisual:
            if let model = node.math { NativeLiveMathVisualRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .svgAttachment:
            if let input = node.attachment { NativeLiveSVGRenderer(input: input) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .math:
            if let model = node.math { NativeLiveMathRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .mermaid:
            if let model = node.code { NativeLiveMermaidRenderer(model: model) }
            else { NativeLiveVisualFallbackView(fallback: node.fallback) }
        case .attachment:
            if let input = node.attachment {
                if input.mediaKind == .bitmap && !input.isMemeSticker {
                    NativeLiveMediaTileWidth { NativeLiveMediaCard(input:input) }
                } else { NativeLiveMediaCard(input:input,stickerImage:input.isMemeSticker) }
            }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .structuredResult:
            NativeLiveStructuredToolResultView(node:node)
        case .structuredJSON:
            if let json=node.json { NativeLiveStructuredJSONView(json:json) }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .searchResult:
            if let search=node.search { NativeLiveSearchResultView(result:search,sources:node.citationSourcesToRender) }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .citation:
            if node.citationSourcesToRender?.isEmpty == true { Text("Source reference").font(.caption).foregroundStyle(.secondary) }
            else { NativeLiveCitationSourcesView(sources:node.citationSourcesToRender ?? NativeLiveCitationSource.aggregate(node.citations)) }
        case .fallback:
            NativeLiveVisualFallbackView(fallback: node.fallback)
        }
    }


}

private struct NativeLiveVisualFallbackView: View {
    let fallback: NativeLiveVisualFallback

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(fallback.title, systemImage: "doc.questionmark")
                .font(.subheadline)
            Text(fallback.rawType).font(.caption)
            Text(fallback.diagnostic).font(.caption)
            ForEach(fallback.metadata.keys.sorted(), id: \.self) { key in
                Text("\(key): \(fallback.metadata[key] ?? "")").font(.caption)
            }
        }
        .foregroundStyle(.secondary)
        .padding(10)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.045,
            originalCornerRadius: 11
        ))
        .accessibilityElement(children: .combine)
    }
}
