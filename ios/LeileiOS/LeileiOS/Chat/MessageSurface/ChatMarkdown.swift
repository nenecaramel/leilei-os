import SwiftUI

// Only iMessage text bubbles use these colors. Keep the parsed Markdown,
// link URLs, underline styles, and Original's native accent colors intact.
enum NativeLiveIMessageMarkdownPalette {
    static let body = Color.white.opacity(0.98)
    static let quote = Color.white.opacity(0.86)

    static func inline(_ source: AttributedString, isQuote: Bool) -> AttributedString {
        var styled = source
        let linkRanges = source.runs.compactMap { run in
            run.link == nil ? nil : run.range
        }
        for range in linkRanges {
            styled[range].foregroundColor = isQuote ? quote : body
        }
        return styled
    }
}

// Shared inline primitive. Classification belongs to the presentation projector.
struct ChatMarkdownView: View {
    private let inline: AttributedString
    let fillsAvailableWidth: Bool
    let lineSpacing: CGFloat
    let paragraphSpacing: CGFloat

    init(text: String, fillsAvailableWidth: Bool, lineSpacing: CGFloat, paragraphSpacing: CGFloat) {
        inline = NativeLiveMarkdownPresentation.inline(text)
        self.fillsAvailableWidth = fillsAvailableWidth
        self.lineSpacing = lineSpacing
        self.paragraphSpacing = paragraphSpacing
    }
    var body: some View {
        Text(inline).font(.system(size: 17)).tracking(0.10).lineSpacing(lineSpacing)
            .textSelection(.enabled)
            .frame(maxWidth: fillsAvailableWidth ? .infinity : nil, alignment: .leading)
            .environment(\.openURL, OpenURLAction { url in
                NativeLiveLinkCapability.openableURL(url.absoluteString) == nil ? .discarded : .systemAction
            })
    }
}

struct NativeLiveMarkdownRenderer: View {
    @Environment(\.chatTheme) private var chatTheme
    let model: NativeLiveMarkdownPresentation
    let role: String
    @ViewBuilder var body: some View {
        switch model.style {
        case .paragraph:
            inline.font(isIMessageBubbleText ? .body : .system(size: 17))
        case .heading(let level):
            inline.font(.system(size: level == 1 ? 20.5 : level == 2 ? 18.5 : 17.5, weight: .semibold))
                .accessibilityAddTraits(.isHeader)
        case .list(let marker, let depth):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker); inline
            }.padding(.leading, CGFloat(depth)*12)
        case .quote(let depth):
            if isIMessageBubbleText {
                inline.foregroundStyle(NativeLiveIMessageMarkdownPalette.quote)
                    .padding(.leading, CGFloat(depth)*12)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.2)).frame(width: 2) }
            } else {
                inline.foregroundStyle(.secondary).padding(.leading, CGFloat(depth)*12)
                    .overlay(alignment: .leading) { Rectangle().fill(Color.primary.opacity(0.2)).frame(width: 2) }
            }
        case .divider: Divider()
        }
    }
    private var isIMessageBubbleText: Bool {
        // Both message sides share native body typography in iMessage mode.
        chatTheme == .iMessage && (role == "user" || role == "assistant")
    }

    private var isQuote: Bool {
        if case .quote(_) = model.style { return true }
        return false
    }

    private var inline: some View {
        Text(
            isIMessageBubbleText
                ? NativeLiveIMessageMarkdownPalette.inline(model.inline, isQuote: isQuote)
                : model.inline
        ).textSelection(.enabled).lineSpacing(isIMessageBubbleText ? 0 : (role == "user" ? 5 : 6))
            .environment(\.openURL, OpenURLAction { url in
                NativeLiveLinkCapability.openableURL(url.absoluteString) == nil ? .discarded : .systemAction
            })
    }
}
