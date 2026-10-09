import Foundation

private func row(_ id: String, _ text: String, _ kind: DaySpaceTodoEntryKind = .completed, creation: Bool = false) -> DaySpaceEditableTodoEntry {
    DaySpaceEditableTodoEntry(id: id, kind: kind, text: text, creation: creation)
}
private func focused(_ owner: Owner, _ id: String, _ offset: Int) {
    precondition(owner.focusRequest?.rowID == id && owner.focusRequest?.offset == offset)
}
private func unchanged(_ owner: Owner, _ ids: [String], _ texts: [String]) {
    precondition(owner.rows.map(\.id) == ids && owner.rows.map(\.text) == texts)
    precondition(owner.focusRequest == nil && owner.errorMessage == "error")
}

@main struct TodoChecks {
    static func main() {
        // UTF-16 selection replacement, including emoji and Chinese, preserves current ID/kind.
        for (text, location, length, before, after) in [
            ("", 0, 0, "", ""), ("abc", 0, 0, "", "abc"),
            ("abc", 3, 0, "abc", ""), ("abcd", 1, 2, "a", "d"),
            ("😀中文", 2, 1, "😀", "文")
        ] {
            var owner = Owner(rows: [row("original", text), row("blank", "", .pending, creation: true)])
            precondition(owner.splitRow(rowID: "original", range: NSRange(location: location, length: length)))
            precondition(owner.rows[0].id == "original" && owner.rows[0].kind == .completed && owner.rows[0].text == before)
            precondition(owner.rows[1].id == "blank" && owner.rows[1].kind == .pending && owner.rows[1].text == after)
            focused(owner, "blank", 0)
            precondition(owner.events == ["normalize", "focus:24"])
            precondition(owner.rows.count == 24 && owner.errorMessage == nil)
        }
        var split = Owner(rows: [row("a", "one"), row("b", "two", .record)])
        precondition(split.splitRow(rowID: "a", range: NSRange(location: 1, length: 0)))
        precondition(split.rows[1].text == "ne" && split.rows[1].kind == .pending && UUID(uuidString: split.rows[1].id) != nil)
        precondition(split.rows[2].id == "b" && split.rows[2].text == "two" && split.rows[2].kind == .record)
        focused(split, split.rows[1].id, 0)

        for previous in [true, false] {
            var owner = Owner(rows: [row("a", "😀中"), row("b", "后", .record)])
            let handled = previous ? owner.mergeWithPrevious(rowID: "b") : owner.mergeWithNext(rowID: "a")
            precondition(handled && owner.rows[0].id == "a" && owner.rows[0].text == "😀中后" && owner.rows[0].kind == .completed)
            focused(owner, "a", 3)
            precondition(owner.events == ["normalize", "focus:24"])
            precondition(owner.errorMessage == nil)
        }
        var noOp = Owner(rows: [row("a", "text"), row("b", "", .pending, creation: true)])
        precondition(noOp.mergeWithNext(rowID: "a"))
        unchanged(noOp, ["a", "b"], ["text", ""])
        var emptyMerge = Owner(rows: [row("a", ""), row("b", "")])
        precondition(emptyMerge.mergeWithPrevious(rowID: "b"))
        precondition(emptyMerge.rows[0].id == "a" && emptyMerge.rows[0].creation)
        focused(emptyMerge, "a", 0)

        // Both newline forms, empty pasted lines, suffix and final-line caret are preserved.
        for (paste, expected, caret) in [
            ("x\ny", ["ax", "yd"], 1), ("x\r\ny\rz", ["ax", "y", "zd"], 1),
            ("\n", ["a", "d"], 0), ("x\n\ny\n", ["ax", "", "y", "d"], 0),
            ("中文\n😀", ["a中文", "😀d"], 2)
        ] {
            var owner = Owner(rows: [row("a", "abcd"), row("tail", "keep", .record)])
            precondition(owner.pasteMultiline(rowID: "a", range: NSRange(location: 1, length: 2), text: paste))
            precondition(Array(owner.rows.prefix(expected.count)).map(\.text) == expected)
            precondition(owner.rows[0].id == "a" && owner.rows[0].kind == .completed)
            for entry in owner.rows[1..<expected.count] { precondition(entry.kind == .pending && UUID(uuidString: entry.id) != nil) }
            precondition(owner.rows[expected.count].id == "tail" && owner.rows[expected.count].kind == .record)
            focused(owner, owner.rows[expected.count - 1].id, caret)
            precondition(owner.events == ["focus:" + String(expected.count + 1), "normalize"])
            precondition(owner.errorMessage == nil)
            precondition(Set(owner.rows.map(\.id)).count == owner.rows.count)
        }
        for range in [NSRange(location: -1, length: 0), NSRange(location: 4, length: 0), NSRange(location: 2, length: 2)] {
            var owner = Owner(rows: [row("a", "abc")])
            precondition(!owner.splitRow(rowID: "a", range: range))
            precondition(!owner.pasteMultiline(rowID: "a", range: range, text: "x\ny"))
            unchanged(owner, ["a"], ["abc"])
        }
        var boundary = Owner(rows: [row("a", "abc")])
        precondition(!boundary.mergeWithPrevious(rowID: "a") && !boundary.mergeWithNext(rowID: "a"))
        precondition(!boundary.splitRow(rowID: "missing", range: NSRange(location: 0, length: 0)))
        precondition(!boundary.pasteMultiline(rowID: "a", range: NSRange(location: 0, length: 0), text: "single"))
        precondition(!boundary.pasteMultiline(rowID: "missing", range: NSRange(location: 0, length: 0), text: "x\ny"))
        unchanged(boundary, ["a"], ["abc"])

        var normalization = Owner(rows: [row("a", "  中文 \n"), row("empty", " \n"), row("b", "two", .record)])
        let saved = normalization.normalizedEntries
        precondition(saved.map(\.id) == ["a", "b"] && saved.map(\.text) == ["中文", "two"])
        precondition(saved.map(\.kind) == [.completed, .record])
        precondition(normalization.rows[0].text == "  中文 \n")
        normalization.normalizeVisibleRows()
        precondition(normalization.rows.count == 24)
        let ids = normalization.rows.map(\.id)
        normalization.normalizeVisibleRows()
        precondition(normalization.rows.map(\.id) == ids)
        normalization.updateText(rowID: "a", text: "")
        precondition(normalization.rows[0].id == "a" && normalization.rows[0].creation && normalization.rows[0].kind == .completed)
        var long = Owner(rows: (0..<30).map { row("r\($0)", "", .pending, creation: true) })
        long.rows[28].text = "last"
        long.normalizeVisibleRows()
        precondition(long.rows.count == 30)
        long.rows[28].text = ""
        long.normalizeVisibleRows()
        precondition(long.rows.count == 24 && long.rows[23].id == "r23")
        // Non-creation or whitespace trailing rows must not be silently removed.
        var retained = Owner(rows: (0..<26).map { row("keep\($0)", "", .pending, creation: true) })
        retained.rows[25].creation = false
        retained.normalizeVisibleRows()
        precondition(retained.rows.count == 26 && retained.rows[25].id == "keep25")
        retained.rows[25].creation = true
        retained.rows[25].text = " "
        retained.normalizeVisibleRows()
        precondition(retained.rows.count == 26 && retained.rows[25].text == " ")
        _ = boundary.moveToNext(rowID: "a")
        precondition(boundary.focusRequest == nil)
        print("Todo row transforms PASS")
    }
}
