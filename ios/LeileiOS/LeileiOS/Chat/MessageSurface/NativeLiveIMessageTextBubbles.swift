import SwiftUI
import Translation

// Presentation-only segments. The original block identities, source text,
// streaming lifecycle and copy/retry targets are never split or rewritten.
enum NativeLiveIMessageTextSegments {
    struct Segment: Identifiable {
        let node: NativeLiveVisualNode
        let isTextBubble: Bool
        var id: String { node.id }
    }

    static func project(_ nodes: [NativeLiveVisualNode]) -> [Segment] {
        nodes.flatMap { project($0) }
    }

    private static func project(_ node: NativeLiveVisualNode) -> [Segment] {
        if node.kind == .markdown && !node.rendersInlineChildren && !node.children.isEmpty {
            return node.children.flatMap { project($0) }
        }

        let textNode = node.kind == .markdown || node.kind == .text
        let isDivider: Bool
        if let model = node.markdown, case .divider = model.style { isDivider = true }
        else { isDivider = false }
        guard textNode, !isDivider else {
            return [.init(node: node, isTextBubble: false)]
        }

        // Split the already-rendered attributed text first. Slicing retains
        // formatting/link runs that may span newlines (such as multiline bold).
        if !node.rendersInlineChildren, let model = node.markdown {
            let renderedLines = model.inline.characters.split(whereSeparator: \.isNewline)
            if renderedLines.count > 1 {
                return renderedLines.enumerated().map { index, line in
                    var part = node
                    part.presentationID = "\(node.id):bubble-line:\(index)"
                    part.sourceRangeUTF16 = nil
                    part.text = String(line)
                    part.children = []
                    part.markdown = .init(
                        style: model.style,
                        inline: AttributedString(model.inline[line.startIndex..<line.endIndex]),
                        isPlainFallback: model.isPlainFallback
                    )
                    return .init(node: part, isTextBubble: true)
                }
            }
        }

        // Split visual paragraphs on *every* explicit newline, including a
        // single newline. Rich code fences, tables, math blocks, media and
        // structured tools are already separate nodes and stay untouched.
        guard let rawText = node.text, rawText.contains(where: \.isNewline) else {
            return [.init(node: node, isTextBubble: true)]
        }
        let lines = rawText.split(whereSeparator: \.isNewline)
        guard lines.count > 1 else {
            return [.init(node: node, isTextBubble: true)]
        }
        return lines.enumerated().flatMap { index, line -> [Segment] in
            var part = node
            part.text = String(line)
            part.presentationID = "\(node.id):bubble-line:\(index)"
            part.sourceRangeUTF16 = nil
            part.children = []
            part.rendersInlineChildren = false
            part.markdown = nil
            // Reproject each visual line through the existing rich-text
            // parser so links, emphasis and inline formulas keep working.
            let children = NativeLiveRichTextProjector.project(part)
            if children.isEmpty {
                return [.init(node: part, isTextBubble: true)]
            }
            return children.flatMap { project($0) }
        }
    }
}

enum NativeLiveIMessageBubbleSide {
    case outgoing
    case incoming
}

// Identical width behavior, insets and corner shape, mirrored by side.
// Width is constrained by the row's 70pt clearance, never an arbitrary cap.
struct NativeLiveIMessageTextBubble<Content: View>: View {
    let side: NativeLiveIMessageBubbleSide
    let content: Content

    init(side: NativeLiveIMessageBubbleSide, @ViewBuilder content: () -> Content) {
        self.side = side
        self.content = content()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            // Short text retains its natural width.
            bubble(content.fixedSize(horizontal: true, vertical: false))
            // Wrapped text is measured by SwiftUI at the available width.
            // The background stays around the rendered content instead of
            // filling the entire row and leaving a blank right-hand strip.
            bubble(content.fixedSize(horizontal: false, vertical: true))
        }
    }

    private func bubble<BubbleContent: View>(_ view: BubbleContent) -> some View {
        view
            .font(.body)
            .padding(.horizontal, ChatPresentationLayout.bubbleHorizontalInset)
            .padding(.vertical, ChatPresentationLayout.iMessageUserBubbleVerticalInset)
            // Match the reference: white text on flat, slightly translucent
            // blue (outgoing) and charcoal (incoming) bubbles.
            .foregroundStyle(Color.white.opacity(0.98))
            .background(
                side == .outgoing
                    ? Color(red: 0.12, green: 0.54, blue: 1.00).opacity(0.94)
                    : Color(red: 0.30, green: 0.31, blue: 0.33).opacity(0.85),
                in: RoundedRectangle(
                    cornerRadius: ChatPresentationLayout.iMessageUserBubbleRadius,
                    style: .continuous
                )
            )
    }
}

// Each assistant text segment owns its context menu and translation state.
// Keeping this on the bubble (not the turn row) avoids stealing long presses
// from thinking, tools, citations, media or other nested controls.
private struct NativeLiveIMessageAssistantTextBubble: View {
    let node: NativeLiveVisualNode
    let timestamp: String?
    let onCopy: (String) -> Void
    let onRetry: (() -> Void)?
    let isRetryDisabled: Bool

    @State private var showsTranslation = false

    private var plainText: String {
        if let markdown = node.markdown {
            return String(markdown.inline.characters)
        }
        return node.text ?? ""
    }

    var body: some View {
        NativeLiveIMessageTextBubble(side: .incoming) {
            NativeLiveVisualNodeView(node: node, role: "assistant")
        }
        .overlay {
            IMessageAssistantBubbleContextMenuInteraction(
                text: plainText,
                timestamp: timestamp,
                isRetryDisabled: isRetryDisabled,
                cornerRadius: ChatPresentationLayout.iMessageUserBubbleRadius,
                onCopy: onCopy,
                onRetry: onRetry,
                onTranslate: { showsTranslation = true }
            )
        }
        .translationPresentation(
            isPresented: $showsTranslation,
            text: plainText
        )
    }
}

// Only text/markdown paragraphs become bubbles. Code, tables, sources, media
// and all other specialized renderers retain their original surfaces.
struct NativeLiveIMessageTextBubbleList: View {
    let presentation: NativeLiveMessagePresentation
    let side: NativeLiveIMessageBubbleSide
    var timestamp: String? = nil
    var onCopy: ((String) -> Void)? = nil
    var onRetry: (() -> Void)? = nil
    var isRetryDisabled = false

    private var segments: [NativeLiveIMessageTextSegments.Segment] {
        let nodes = side == .outgoing ? presentation.textNodes : presentation.renderNodes
        return NativeLiveIMessageTextSegments.project(nodes)
    }

    var body: some View {
        VStack(alignment: side == .outgoing ? .trailing : .leading, spacing: ChatPresentationLayout.iMessageTextBubbleSpacing) {
            ForEach(Array(segments.enumerated()), id: \.element.id) { index, segment in
                Group {
                    if segment.isTextBubble {
                        if side == .incoming {
                            HStack(spacing: 0) {
                                NativeLiveIMessageAssistantTextBubble(
                                    node: segment.node,
                                    timestamp: timestamp,
                                    onCopy: onCopy ?? { _ in },
                                    onRetry: onRetry,
                                    isRetryDisabled: isRetryDisabled
                                )
                                .frame(maxWidth:.infinity,alignment:.leading)
                                // Mirror the user's exact 70pt clearance so
                                // the wrapped bubble receives the full width.
                                Color.clear.frame(width:ChatPresentationLayout.iMessageUserLeadingClearance)
                            }
                        } else {
                            NativeLiveIMessageTextBubble(side: side) {
                                NativeLiveVisualNodeView(node: segment.node, role: presentation.role)
                            }
                        }
                    } else {
                        // Rich non-text nodes retain their existing renderers.
                        NativeLiveVisualNodeView(node: segment.node, role: presentation.role)
                    }
                }
                // Special renderers keep their existing 22pt separation;
                // only consecutive ordinary text bubbles change to 8pt.
                .padding(.top, side == .incoming && index > 0 &&
                    (!segment.isTextBubble || !segments[index - 1].isTextBubble)
                        ? 22 - ChatPresentationLayout.iMessageTextBubbleSpacing : 0)
            }
            if side == .incoming && !presentation.citationSources.isEmpty {
                NativeLiveCitationSourcesView(sources: presentation.citationSources)
                    // Preserve the previous 12pt source separation.
                    .padding(.top, 12 - ChatPresentationLayout.iMessageTextBubbleSpacing)
            }
        }
    }
}
