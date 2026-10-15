import SwiftUI

struct NativeLiveMathRenderer: View {
    let model: NativeLiveMathPresentation

    var body: some View {
        NativeLiveSourcePanel(
            label:
                model.isDisplay
                    ? "Math · LaTeX source"
                    : "Inline math · LaTeX source",
            copyText: model.latex
        ) {
            Text(model.latex)
                .font(.system(size: 15, design: .monospaced))
                .accessibilityLabel("Math: \(model.latex)")
        }
        .accessibilityHint("LaTeX source fallback")
    }
}

// Inline math is already classified by NativeLiveRichTextProjector. Keep the
// paragraph wrapping natively, but render math runs with the visual math
// surface instead of exposing raw LaTeX in the paragraph.
struct NativeLiveInlineMathParagraphRenderer: View {
    @Environment(\.chatTheme) private var chatTheme
    let node: NativeLiveVisualNode
    let model: NativeLiveMarkdownPresentation
    let role: String

    @ViewBuilder
    var body: some View {
        switch model.style {
        case .paragraph:
            flow

        case .heading(let level):
            flow
                .font(
                    .system(
                        size:
                            level == 1
                                ? 20.5
                                : level == 2
                                    ? 18.5
                                    : 17.5,
                        weight: .semibold
                    )
                )
                .accessibilityAddTraits(.isHeader)

        case .list(let marker, let depth):
            HStack(alignment: .top, spacing: 8) {
                Text(marker)
                    .font(isIMessageBubbleText ? .body : .system(size: 17))
                flow
            }
            .padding(.leading, CGFloat(depth) * 12)

        case .quote(let depth):
            flow
                .foregroundStyle(.secondary)
                .padding(.leading, CGFloat(depth) * 12)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Color.primary.opacity(0.2))
                        .frame(width: 2)
                }

        case .divider:
            Divider()
        }
    }

    private var isIMessageBubbleText: Bool {
        chatTheme == .iMessage && (role == "user" || role == "assistant")
    }

    private var flow: some View {
        NativeLiveInlineMathFlowLayout(
            horizontalSpacing: 1,
            verticalSpacing: 4
        ) {
            ForEach(node.children) { child in
                if let math = child.math {
                    NativeLiveInlineMathVisualRenderer(model: math)
                } else if let markdown = child.markdown {
                    Text(markdown.inline)
                        .font(isIMessageBubbleText ? .body : .system(size: 17))
                        .textSelection(.enabled)
                        .lineSpacing(isIMessageBubbleText ? 0 : (role == "user" ? 5 : 6))
                        .environment(
                            \.openURL,
                            OpenURLAction { url in
                                NativeLiveLinkCapability.openableURL(
                                    url.absoluteString
                                ) == nil
                                    ? .discarded
                                    : .systemAction
                            }
                        )
                } else if let text = child.text {
                    Text(text)
                        .font(isIMessageBubbleText ? .body : .system(size: 17))
                        .textSelection(.enabled)
                }
            }
        }
    }
}

private struct NativeLiveInlineMathVisualRenderer: View {
    let model: NativeLiveMathPresentation

    var body: some View {
        if let input =
            try? NativeLiveVisualSandboxInput.inlineMath(model) {
            NativeLiveVisualSurface(
                input: input,
                label: "Inline math",
                compactInline: true
            )
        } else {
            Text(model.latex)
                .font(.system(size: 15, design: .monospaced))
        }
    }
}

private struct NativeLiveInlineMathFlowLayout: Layout {
    let horizontalSpacing: CGFloat
    let verticalSpacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let width = max(1, proposal.width ?? 320)
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maximumX: CGFloat = 0

        for subview in subviews {
            let measured = subview.sizeThatFits(
                ProposedViewSize(
                    width: width,
                    height: nil
                )
            )
            let itemWidth = min(width, measured.width)

            if x > 0,
               x + itemWidth > width {
                y += rowHeight + verticalSpacing
                x = 0
                rowHeight = 0
            }

            x += itemWidth
            maximumX = max(maximumX, x)
            rowHeight = max(rowHeight, measured.height)
            x += horizontalSpacing
        }

        return CGSize(
            width: proposal.width ?? min(width, maximumX),
            height: y + rowHeight
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let width = max(1, bounds.width)
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let measured = subview.sizeThatFits(
                ProposedViewSize(
                    width: width,
                    height: nil
                )
            )
            let itemWidth = min(width, measured.width)

            if x > bounds.minX,
               x - bounds.minX + itemWidth > width {
                y += rowHeight + verticalSpacing
                x = bounds.minX
                rowHeight = 0
            }

            subview.place(
                at: CGPoint(x: x, y: y),
                anchor: .topLeading,
                proposal: ProposedViewSize(
                    width: itemWidth,
                    height: measured.height
                )
            )

            x += itemWidth + horizontalSpacing
            rowHeight = max(rowHeight, measured.height)
        }
    }
}
