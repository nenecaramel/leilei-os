import Foundation

// Iterative, bounded projection, invoked before rendering; no SwiftUI-body parsing.
enum NativeLiveRichTextProjector {
    static let maximumUTF16 = 131_072
    static let maximumNodes = 2048
    static let maximumTableCells = 512
    private struct Line {
        let text: String
        let start: Int
        let end: Int
        var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private static let cache = ProjectionCache()
    static func project(_ parent: NativeLiveVisualNode) -> [NativeLiveVisualNode] {
        if let hit = cache.lookup(parent) { return hit }
        let nodes = projectUncached(parent)
        cache.store(parent, nodes)
        return nodes
    }

    private static func projectUncached(_ parent: NativeLiveVisualNode) -> [NativeLiveVisualNode] {
        guard let source = parent.text, !source.isEmpty else { return [] }
        var generatedNodes = 0
        var budgetExceeded = false
        func node(_ kind: NativeLiveVisualNodeKind, _ text: String, _ start: Int, _ end: Int) -> NativeLiveVisualNode {
            generatedNodes += 1
            var child = parent
            child.kind = kind; child.text = text; child.children = []
            child.presentationID = "\(parent.id):rich:\(start):\(kind.rawValue)"
            child.sourceRangeUTF16 = start..<end
            child.citationSourcesToRender = nil
            return child
        }
        func plainFallback() -> [NativeLiveVisualNode] {
            var child = node(.text, source, 0, source.utf16.count)
            child.markdown = .init(style: .paragraph, inline: AttributedString(source), isPlainFallback: true)
            return [child]
        }
        guard source.utf16.count <= maximumUTF16 else { return plainFallback() }
        let ns = source as NSString
        var offset = 0
        let lines = source.components(separatedBy: "\n").map { text -> Line in
            let start = offset; offset += text.utf16.count + 1
            return .init(text: text,
                         start: start, end: min(offset, ns.length))
        }
        var result: [NativeLiveVisualNode] = []
        var i = 0
        func raw(_ a: Int, _ b: Int) -> String { ns.substring(with: NSRange(location: a, length: b-a)) }
        func appendMarkdown(_ text: String, style: NativeLiveMarkdownPresentation.Style, start: Int, end: Int, math: Bool = true) {
            // Inline math uses explicit paired delimiters, rejects currency and code/link spans.
            guard let pieces = math ? inlineMath(text) : [(text, false, 0)] else { budgetExceeded = true; return }
            guard generatedNodes + pieces.count + (pieces.contains { $0.1 } ? 1 : 0) <= maximumNodes else { budgetExceeded = true; return }
            var runs: [NativeLiveVisualNode] = []
            for (content, isMath, localStart) in pieces {
                var child = node(isMath ? .math : .markdown, content, start + localStart, min(end, start + localStart + content.utf16.count + (isMath ? 2 : 0)))
                if isMath { child.math = .init(latex: content, isDisplay: false) }
                else { child.markdown = .init(style: style, inline: NativeLiveMarkdownPresentation.inline(content), isPlainFallback: false) }
                runs.append(child)
            }
            if runs.contains(where: { $0.kind == .math }) {
                var group = node(.markdown, text, start, end)
                group.presentationID = "\(parent.id):rich:\(start):inline"
                group.children = runs; group.rendersInlineChildren = true
                // Parse one paragraph with protected math placeholders; emphasis may span a formula.
                var protected = "", formulas: [(String, String)] = []
                var prefix = "LeileiRichMathPlaceholder"
                // A collision cannot silently replace user text.
                for _ in 0..<8 where text.contains(prefix) { prefix += "X" }
                guard !text.contains(prefix) else { budgetExceeded = true; return }
                for (index, piece) in pieces.enumerated() {
                    if piece.1 {
                        let token = prefix + String(index) + "End"
                        protected += token; formulas.append((token, piece.0))
                    } else { protected += piece.0 }
                }
                var inline = NativeLiveMarkdownPresentation.inline(protected)
                for (token, latex) in formulas {
                    if let range = inline.range(of: token) {
                        let attributes = inline[range].runs.first?.attributes ?? AttributeContainer()
                        var formula = AttributedString(latex, attributes: attributes)
                        formula.inlinePresentationIntent = (formula.inlinePresentationIntent ?? []).union(.code)
                        inline.replaceSubrange(range, with: formula)
                    }
                }
                group.markdown = .init(style: style, inline: inline, isPlainFallback: false)
                result.append(group)
            } else { result += runs }
        }
        while i < lines.count {
            if generatedNodes >= maximumNodes || budgetExceeded { return plainFallback() }
            let line = lines[i], t = line.trimmed
            if t.isEmpty { i += 1; continue }
            if let (marker, count, info) = fence(t) {
                var j = i + 1
                while j < lines.count {
                    let candidate = lines[j].trimmed
                    if candidate.prefix(while: { $0 == marker }).count >= count,
                       candidate.drop(while: { $0 == marker }).trimmingCharacters(in: .whitespaces).isEmpty { break }
                    j += 1
                }
                let closed = j < lines.count
                let bodyStart = line.end
                // Exclude exactly the newline before the closing fence; preserve all other whitespace.
                var bodyEnd = closed ? lines[j].start : ns.length
                if closed, bodyEnd > bodyStart, ns.substring(with: NSRange(location: bodyEnd-1, length: 1)) == "\n" { bodyEnd -= 1
                    if bodyEnd > bodyStart, ns.substring(with: NSRange(location: bodyEnd-1, length: 1)) == "\r" { bodyEnd -= 1 }
                }
                let code = raw(min(bodyStart, ns.length), max(bodyStart, bodyEnd))
                let language = info.split(whereSeparator: { $0.isWhitespace }).first?.lowercased()
                let kind: NativeLiveVisualNodeKind = ["diff", "patch"].contains(language ?? "") ? .diff : language == "mermaid" ? .mermaid : .code
                var child = node(kind, code, line.start, closed ? lines[j].end : ns.length)
                child.code = .init(info: info, code: code, closed: closed)
                if kind == .diff { child.diff = .init(code) }
                result.append(child); i = closed ? j+1 : lines.count; continue
            }
            if t == "$$" || (t.hasPrefix("$$") && t.hasSuffix("$$") && t.count > 4) {
                var j = i, latex: String?
                if t.count > 4 { latex = String(t.dropFirst(2).dropLast(2)) }
                else {
                    j += 1
                    while j < lines.count && lines[j].trimmed != "$$" { j += 1 }
                    if j < lines.count { latex = lines[(i+1)..<j].map(\.text).joined(separator: "\n") }
                }
                if let latex {
                    var child = node(.math, latex, line.start, lines[j].end)
                    child.math = .init(latex: latex, isDisplay: true)
                    result.append(child); i = j+1; continue
                }
            }
            if i+1 < lines.count, let table = table(lines, at: i, source: ns) {
                var child = node(.table, table.model.rawSource, line.start, lines[table.end-1].end)
                child.table = table.model; result.append(child); i = table.end; continue
            }
            if let styled = style(line.text) {
                let contentOffset = styled.text.isEmpty ? 0 : (line.text as NSString).range(of: styled.text, options: .backwards).location
                appendMarkdown(styled.text, style: styled.style, start: line.start + contentOffset, end: line.end)
                i += 1; continue
            }
            var j = i+1
            while j < lines.count && !lines[j].trimmed.isEmpty && fence(lines[j].trimmed) == nil && style(lines[j].text) == nil && !lines[j].trimmed.hasPrefix("$$") {
                if j+1 < lines.count, table(lines, at: j, source: ns) != nil { break }
                j += 1
            }
            appendMarkdown(lines[i..<j].map(\.text).joined(separator: "\n"), style: .paragraph, start: line.start, end: lines[j-1].end)
            i = j
        }
        return result.isEmpty || budgetExceeded || generatedNodes > maximumNodes ? plainFallback() : result
    }

    private static func fence(_ text: String) -> (Character, Int, String)? {
        guard let first = text.first, first == "`" || first == "~" else { return nil }
        let count = text.prefix(while: { $0 == first }).count
        guard count >= 3 else { return nil }
        let info = text.dropFirst(count).trimmingCharacters(in: .whitespaces)
        if first == "`", info.contains("`") { return nil }
        return (first, count, info)
    }

    private static func style(_ source: String) -> (style: NativeLiveMarkdownPresentation.Style, text: String)? {
        let t = source.trimmingCharacters(in: .whitespacesAndNewlines)
        if ["---", "***", "___"].contains(t) { return (.divider, "") }
        let hashes = t.prefix(while: { $0 == "#" }).count
        if (1...6).contains(hashes), t.dropFirst(hashes).first == " " {
            return (.heading(hashes), String(t.dropFirst(hashes+1)))
        }
        if t.hasPrefix(">") {
            var cursor = t.startIndex, depth = 0
            while cursor < t.endIndex && t[cursor] == ">" {
                depth += 1; cursor = t.index(after: cursor)
                while cursor < t.endIndex && t[cursor].isWhitespace { cursor = t.index(after: cursor) }
            }
            return (.quote(min(depth, 8)), String(t[cursor...]))
        }
        let indent = source.prefix(while: { $0 == " " || $0 == "\t" }).reduce(0) { $0 + ($1 == "\t" ? 4 : 1) }
        let depth = min(indent / 2, 8)
        if ["- ", "* ", "+ "].contains(String(t.prefix(2))) { return (.list(marker: "•", depth: depth), String(t.dropFirst(2))) }
        let digits = t.prefix(while: { $0.isASCII && $0.isNumber })
        let rest = t.dropFirst(digits.count)
        if !digits.isEmpty, digits.count <= 9, rest.hasPrefix(". ") || rest.hasPrefix(") ") {
            return (.list(marker: String(digits)+".", depth: depth), String(rest.dropFirst(2)))
        }
        return nil
    }

    private static func cells(_ line: String) -> [String] {
        var result: [String] = [], cell = "", escaped = false, inCode = false
        var t = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|"), !t.hasSuffix("\\|") { t.removeLast() }
        for c in t {
            if escaped { cell.append(c == "|" ? "|" : "\\"+String(c)); escaped = false; continue }
            if c == "\\" { escaped = true; continue }
            if c == "`" { inCode.toggle() }
            if c == "|" && !inCode { result.append(cell.trimmingCharacters(in: .whitespacesAndNewlines)); cell = "" }
            else { cell.append(c) }
        }
        if escaped { cell.append("\\") }
        result.append(cell.trimmingCharacters(in: .whitespacesAndNewlines)); return result
    }

    private static func table(_ lines: [Line], at i: Int, source: NSString) -> (model: NativeLiveTablePresentation, end: Int)? {
        guard i+1 < lines.count, lines[i].text.contains("|") else { return nil }
        let headers = cells(lines[i].text), separators = cells(lines[i+1].text)
        guard headers.count == separators.count, headers.count <= 32, !headers.isEmpty else { return nil }
        var alignments: [NativeLiveTablePresentation.Alignment] = []
        for separator in separators {
            let dashes = separator.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            guard dashes.count >= 3, dashes.allSatisfy({ $0 == "-" }) else { return nil }
            alignments.append(separator.hasPrefix(":") && separator.hasSuffix(":") ? .center : separator.hasSuffix(":") ? .trailing : .leading)
        }
        var rows: [[String]] = [], j = i+2
        while j < lines.count && !lines[j].trimmed.isEmpty && lines[j].text.contains("|") {
            let row = cells(lines[j].text)
            guard row.count == headers.count, (rows.count+2)*headers.count <= maximumTableCells else { return nil }
            rows.append(row); j += 1
        }
        let raw = source.substring(with: NSRange(location: lines[i].start, length: lines[j-1].end-lines[i].start))
        return (.init(headers: headers, rows: rows, alignments: alignments, rawSource: raw,
                      cells: ([headers]+rows).map { $0.map(NativeLiveMarkdownPresentation.inline) }), j)
    }

    private static func inlineMath(_ text: String) -> [(String, Bool, Int)]? {
        // Linear scan. Code and link destinations stay native inline Markdown.
        let chars = Array(text)
        var pieces: [(String, Bool, Int)] = [], start = 0, i = 0, utf16 = 0, startOffset = 0
        var codeDelimiter: Int? = nil
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i+1 < chars.count { utf16 += String(chars[i...i+1]).utf16.count; i += 2; continue }
            if c == "`" {
                var j = i
                while j < chars.count && chars[j] == "`" { j += 1 }
                let count = j-i
                if codeDelimiter == nil { codeDelimiter = count }
                else if codeDelimiter == count { codeDelimiter = nil }
                utf16 += count; i = j; continue
            }
            if c == "]", codeDelimiter == nil, i+1 < chars.count, chars[i+1] == "(" {
                var j = i+2, depth = 1
                while j < chars.count && depth > 0 {
                    if chars[j] == "\\", j+1 < chars.count { j += 2; continue }
                    if chars[j] == "(" { depth += 1 }
                    if chars[j] == ")" { depth -= 1 }
                    j += 1
                }
                utf16 += String(chars[i..<j]).utf16.count; i = j; continue
            }
            if c == "$", codeDelimiter == nil, i+1 < chars.count, !chars[i+1].isWhitespace, !chars[i+1].isNumber, chars[i+1] != "$",
               (i == 0 || chars[i-1] != "$") {
                var j = i+1
                while j < chars.count && j-i <= 2048 && chars[j] != "$" && chars[j] != "\n" {
                    if chars[j] == "\\", j+1 < chars.count { j += 2 } else { j += 1 }
                }
                if j < chars.count, chars[j] == "$", j > i+1, !chars[j-1].isWhitespace,
                   (j+1 == chars.count || chars[j+1] != "$"), j-i <= 2048 {
                    guard pieces.count + 2 < maximumNodes else { return nil }
                    if start < i { pieces.append((String(chars[start..<i]), false, startOffset)) }
                    pieces.append((String(chars[(i+1)..<j]), true, utf16))
                    utf16 += String(chars[i...j]).utf16.count; i = j+1; start = i; startOffset = utf16; continue
                }
            }
            utf16 += String(c).utf16.count; i += 1
        }
        if start < chars.count { pieces.append((String(chars[start...]), false, startOffset)) }
        return pieces.isEmpty ? [(text, false, 0)] : pieces
    }
}

// Equality includes source text, provenance, citations and structured-part namespace.
// Cache holds at most 8 inputs / 262k source UTF-16 units; no unbounded history.
private final class ProjectionCache: @unchecked Sendable {
    private struct Entry { let input: NativeLiveVisualNode; let nodes: [NativeLiveVisualNode]; let cost: Int }
    private let lock = NSLock()
    private var entries: [Entry] = []
    func lookup(_ input: NativeLiveVisualNode) -> [NativeLiveVisualNode]? {
        lock.lock(); defer { lock.unlock() }
        return entries.first { $0.input == input }?.nodes
    }
    func store(_ input: NativeLiveVisualNode, _ nodes: [NativeLiveVisualNode]) {
        let cost = input.text?.utf16.count ?? 0
        guard cost <= 262_144 else { return }
        lock.lock(); defer { lock.unlock() }
        entries.removeAll { $0.input == input }
        entries.append(.init(input: input, nodes: nodes, cost: cost))
        while entries.count > 8 || entries.reduce(0, { $0 + $1.cost }) > 262_144 { entries.removeFirst() }
    }
}
