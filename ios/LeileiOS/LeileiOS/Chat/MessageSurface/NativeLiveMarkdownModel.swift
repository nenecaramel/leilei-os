import Foundation
import SwiftUI

nonisolated struct NativeLiveMarkdownPresentation: Equatable, Sendable {
    enum Style: Equatable, Sendable {
        case paragraph, heading(Int), list(marker: String, depth: Int), quote(Int), divider
    }
    let style: Style
    let inline: AttributedString
    let isPlainFallback: Bool

    static func inline(_ source: String) -> AttributedString {
        // HTML remains literal. Native inline parsing never grants link authority.
        guard !source.contains("<"), var value = try? AttributedString(markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else { return AttributedString(source) }
        let linkRuns = value.runs.compactMap { run in
            run.link.map { (range: run.range, link: $0) }
        }
        for run in linkRuns {
            guard NativeLiveLinkCapability.openableURL(run.link.absoluteString) != nil else {
                value[run.range].link = nil
                continue
            }
            value[run.range].foregroundColor = .accentColor
            value[run.range].underlineStyle = .single
        }
        return value
    }
}

struct NativeLiveCodePresentation: Equatable, Sendable {
    let info: String
    let code: String
    let closed: Bool
    var language: String? { info.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) }
}

struct NativeLiveTablePresentation: Equatable, Sendable {
    enum Alignment: Equatable, Sendable { case leading, center, trailing }
    let headers: [String]
    let rows: [[String]]
    let alignments: [Alignment]
    let rawSource: String
    let cells: [[AttributedString]]
    // Fixed, bounded widths avoid long cells expanding the conversation.
    var columnWidth: Double { 180 }
}

struct NativeLiveDiffPresentation: Equatable, Sendable {
    enum Kind: String, Equatable, Sendable { case context, added, removed, hunk, header }
    struct Line: Equatable, Sendable {
        let text: String
        let kind: Kind
        var accessibilityText: String { "\(kind.rawValue): \(text)" }
    }
    let rawSource: String
    let lines: [Line]
    init(_ source: String) {
        rawSource = source
        lines = source.components(separatedBy: "\n").map { line in
            let kind: Kind
            if line.hasPrefix("+++ ") || line.hasPrefix("--- ") || line.hasPrefix("diff ") || line.hasPrefix("index ") { kind = .header }
            else if line.hasPrefix("@@") { kind = .hunk }
            else if line.hasPrefix("+") { kind = .added }
            else if line.hasPrefix("-") { kind = .removed }
            else { kind = .context }
            return .init(text: line, kind: kind)
        }
    }
}

struct NativeLiveMathPresentation: Equatable, Sendable {
    let latex: String
    let isDisplay: Bool
}
