import SwiftUI

struct ChatMarkdownView: View {
    let text: String
    let fillsAvailableWidth: Bool
    let lineSpacing: CGFloat
    let paragraphSpacing: CGFloat

    private let baseFontSize: CGFloat = 17

    var body: some View {
        VStack(alignment: .leading, spacing: paragraphSpacing) {
            ForEach(
                Array(ChatMarkdownParser.blocks(from: text).enumerated()),
                id: \.offset
            ) { _, block in
                blockView(block)
            }
        }
        .frame(
            maxWidth: fillsAvailableWidth ? .infinity : nil,
            alignment: .leading
        )
    }

    @ViewBuilder
    private func blockView(
        _ block: ChatMarkdownBlock
    ) -> some View {
        switch block {
        case .paragraph(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)

        case .heading(let level, let text):
            inlineText(text)
                .font(.system(
                    size: headingSize(level),
                    weight: level <= 2 ? .semibold : .medium
                ))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .padding(.top, level == 1 ? 2 : 0)

        case .quote(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.primary.opacity(0.20))
                        .frame(width: 2)
                }

        case .unorderedItem(let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .orderedItem(let number, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(number).")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .foregroundStyle(.secondary)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .codeBlock(let code):
            Text(code)
                .font(.system(size: 14, design: .monospaced))
                .tracking(0.08)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.primary.opacity(0.055),
                    in: RoundedRectangle(
                        cornerRadius: 10,
                        style: .continuous
                    )
                )

        case .divider:
            Divider()
                .opacity(0.55)
        }
    }

    private func inlineText(_ source: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: source,
            options: .init(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return Text(attributed)
        }

        return Text(source)
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1:
            return 20.5
        case 2:
            return 18.5
        case 3:
            return 17.5
        default:
            return 17
        }
    }
}

enum ChatMarkdownBlock {
    case paragraph(String)
    case heading(level: Int, text: String)
    case quote(String)
    case unorderedItem(String)
    case orderedItem(number: Int, text: String)
    case codeBlock(String)
    case divider
}

enum ChatMarkdownParser {
    static func blocks(
        from source: String
    ) -> [ChatMarkdownBlock] {
        let lines = source.components(separatedBy: .newlines)
        var result: [ChatMarkdownBlock] = []
        var paragraph: [String] = []
        var codeLines: [String] = []
        var isInCodeBlock = false

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            result.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph.removeAll(keepingCapacity: true)
        }

        func flushCodeBlock() {
            result.append(.codeBlock(codeLines.joined(separator: "\n")))
            codeLines.removeAll(keepingCapacity: true)
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flushParagraph()

                if isInCodeBlock {
                    flushCodeBlock()
                    isInCodeBlock = false
                } else {
                    isInCodeBlock = true
                }
                continue
            }

            if isInCodeBlock {
                codeLines.append(line)
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if trimmed == "---"
                || trimmed == "***"
                || trimmed == "___" {
                flushParagraph()
                result.append(.divider)
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                result.append(
                    .heading(
                        level: heading.level,
                        text: heading.text
                    )
                )
                continue
            }

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                result.append(
                    .quote(String(trimmed.dropFirst(2)))
                )
                continue
            }

            if let item = unorderedItem(from: trimmed) {
                flushParagraph()
                result.append(.unorderedItem(item))
                continue
            }

            if let item = orderedItem(from: trimmed) {
                flushParagraph()
                result.append(
                    .orderedItem(
                        number: item.number,
                        text: item.text
                    )
                )
                continue
            }

            paragraph.append(line)
        }

        flushParagraph()

        if isInCodeBlock || !codeLines.isEmpty {
            flushCodeBlock()
        }

        return result
    }

    private static func heading(
        from line: String
    ) -> (level: Int, text: String)? {
        let level = line.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else {
            return nil
        }

        let index = line.index(
            line.startIndex,
            offsetBy: level
        )
        guard index < line.endIndex,
              line[index] == " " else {
            return nil
        }

        let text = String(line[line.index(after: index)...])
        return (level, text)
    }

    private static func unorderedItem(
        from line: String
    ) -> String? {
        for prefix in ["- ", "* ", "+ "] {
            if line.hasPrefix(prefix) {
                return String(line.dropFirst(prefix.count))
            }
        }

        return nil
    }

    private static func orderedItem(
        from line: String
    ) -> (number: Int, text: String)? {
        guard let dot = line.firstIndex(of: ".") else {
            return nil
        }

        let numberText = line[..<dot]
        guard let number = Int(numberText) else {
            return nil
        }

        let afterDot = line.index(after: dot)
        guard afterDot < line.endIndex,
              line[afterDot] == " " else {
            return nil
        }

        let textStart = line.index(after: afterDot)
        return (
            number,
            String(line[textStart...])
        )
    }
}
