import Foundation

// Value calculations only. The page owns row IDs, mutations and focus scheduling.
enum DaySpaceTodoRowTransforms {
    static func normalizedEntries(
        _ rows: [DaySpaceEditableTodoEntry]
    ) -> [DaySpaceTodoEntry] {
        rows.compactMap { row -> DaySpaceTodoEntry? in
            let text = row.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            )

            guard !text.isEmpty else {
                return nil
            }

            return DaySpaceTodoEntry(
                id: row.id,
                kind: row.kind,
                text: text
            )
        }
    }

    static func visibleRowTargetCount(
        _ rows: [DaySpaceEditableTodoEntry]
    ) -> Int {
        let lastContentIndex = rows.lastIndex {
            !$0.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        }

        let targetCount = max(
            24,
            (lastContentIndex ?? -1) + 2
        )

        return targetCount
    }

    static func splitText(
        _ text: String,
        range: NSRange
    ) -> (before: String, after: String)? {
        let source = text as NSString
        guard range.location >= 0,
              NSMaxRange(range) <= source.length
        else {
            return nil
        }

        let before = source.substring(
            with: NSRange(
                location: 0,
                length: range.location
            )
        )
        let after = source.substring(
            from: NSMaxRange(range)
        )
        return (before, after)
    }

    static func mergeText(
        _ previous: String,
        _ next: String
    ) -> (text: String, caretOffset: Int) {
        (previous + next, previous.utf16.count)
    }

    static func pasteText(
        _ current: String,
        range: NSRange,
        text: String
    ) -> (first: String, remaining: [String], caretOffset: Int)? {
        guard text.contains("\n") || text.contains("\r"),
              let parts = splitText(current, range: range) else {
            return nil
        }

        let normalized = text.replacingOccurrences(
            of: "\r\n",
            with: "\n"
        )
        .replacingOccurrences(
            of: "\r",
            with: "\n"
        )
        let lines = normalized.components(separatedBy: "\n")
        guard lines.count > 1 else { return nil }

        let remaining = (1..<lines.count).map { lineIndex in
            let line = lines[lineIndex]
            let isLast = lineIndex == lines.count - 1
            return isLast ? line + parts.after : line
        }
        return (
            parts.before + (lines.first ?? ""),
            remaining,
            (lines.last ?? "").utf16.count
        )
    }
}
