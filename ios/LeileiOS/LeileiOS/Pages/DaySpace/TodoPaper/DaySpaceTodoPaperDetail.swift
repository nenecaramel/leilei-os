import SwiftUI
import UIKit

struct DaySpaceTodoPaperDetail: View {
    let paper: DaySpaceTodoPaper?
    let date: String
    let unavailableAuthors: [DaySpaceAuthor]
    let onSaved: (DaySpaceTodoPaper) -> Void
    let onClosed: () -> Void

    @EnvironmentObject private var appModel: AppModel

    @State private var author: DaySpaceAuthor
    @State private var rows: [DaySpaceEditableTodoEntry]
    @State private var focusRequest: DaySpaceTodoFocusRequest?
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        paper: DaySpaceTodoPaper,
        onSaved: @escaping (DaySpaceTodoPaper) -> Void,
        onClosed: @escaping () -> Void
    ) {
        self.paper = paper
        self.date = paper.date
        self.unavailableAuthors = []
        self.onSaved = onSaved
        self.onClosed = onClosed
        _author = State(initialValue: paper.author)
        _rows = State(
            initialValue: DaySpaceEditableTodoEntry.initialRows(
                author: paper.author,
                entries: paper.entries
            )
        )
    }

    init(
        date: String,
        unavailableAuthors: [DaySpaceAuthor],
        onSaved: @escaping (DaySpaceTodoPaper) -> Void,
        onClosed: @escaping () -> Void
    ) {
        let initialAuthor = DaySpaceAuthor.allCases.first { candidate in
            !unavailableAuthors.contains {
                $0.rawValue == candidate.rawValue
            }
        } ?? .L

        self.paper = nil
        self.date = date
        self.unavailableAuthors = unavailableAuthors
        self.onSaved = onSaved
        self.onClosed = onClosed
        _author = State(initialValue: initialAuthor)
        _rows = State(
            initialValue: DaySpaceEditableTodoEntry.initialRows(
                author: initialAuthor,
                entries: []
            )
        )
    }

    var body: some View {
        DaySpacePaperDetailLayer(
            dateLabel: DaySpaceDate.paperLabel(date),
            errorMessage: errorMessage,
            onRequestClose: {
                Task {
                    await requestClose()
                }
            },
            topRight: {
                EmptyView()
            },
            signature: {
                if paper == nil {
                    Menu {
                        Picker("", selection: $author) {
                            ForEach(DaySpaceAuthor.allCases) { candidate in
                                Text(candidate.rawValue)
                                    .tag(candidate)
                                    .disabled(
                                        unavailableAuthors.contains {
                                            $0.rawValue == candidate.rawValue
                                        }
                                    )
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    } label: {
                        Text(author.rawValue)
                            .font(
                                .system(
                                    size: 20,
                                    weight: .medium,
                                    design: .serif
                                )
                            )
                            .foregroundStyle(
                                Color(
                                    white: 0.52
                                )
                            )
                    }
                    .onChange(of: author) { _, _ in
                        errorMessage = nil
                    }
                    .accessibilityLabel("Todo author \(author.rawValue)")
                } else {
                    Text(author.rawValue)
                        .font(
                            .system(
                                size: 20,
                                weight: .medium,
                                design: .serif
                            )
                        )
                        .foregroundStyle(
                            Color(
                                white: 0.52
                            )
                        )
                }
            }
        ) {
            LazyVStack(spacing: 0) {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: 8) {
                        Button {
                            cycleStatus(row.id)
                        } label: {
                            DaySpaceTodoEditorMark(
                                kind: row.kind
                            )
                            .frame(
                                width: 22,
                                height: 30
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Change todo status")

                        DaySpaceTodoLineEditor(
                            text: row.text,
                            kind: row.kind,
                            rowID: row.id,
                            focusRequest: focusRequest,
                            onTextChange: { text in
                                updateText(
                                    rowID: row.id,
                                    text: text
                                )
                            },
                            onSplit: { range in
                                splitRow(
                                    rowID: row.id,
                                    range: range
                                )
                            },
                            onMergePrevious: {
                                mergeWithPrevious(
                                    rowID: row.id
                                )
                            },
                            onMergeNext: {
                                mergeWithNext(
                                    rowID: row.id
                                )
                            },
                            onMovePrevious: {
                                moveToPrevious(
                                    rowID: row.id
                                )
                            },
                            onMoveNext: {
                                moveToNext(
                                    rowID: row.id
                                )
                            },
                            onPasteMultiline: { range, text in
                                pasteMultiline(
                                    rowID: row.id,
                                    range: range,
                                    text: text
                                )
                            }
                        )
                        .padding(.trailing, 4)
                        .frame(
                            maxWidth: .infinity,
                            minHeight: 30,
                            alignment: .topLeading
                        )
                    }
                    .frame(
                        minHeight: 30,
                        alignment: .top
                    )
                    .opacity(row.creation ? 0.58 : 1)
                }
            }
        }
    }

    private var normalizedEntries: [DaySpaceTodoEntry] {
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

    private var isDirty: Bool {
        let current = normalizedEntries

        guard let paper else {
            return !current.isEmpty
        }

        guard current.count == paper.entries.count else {
            return true
        }

        for (left, right) in zip(
            current,
            paper.entries
        ) {
            if left.id != right.id
                || left.kind != right.kind
                || left.text
                    != right.text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ) {
                return true
            }
        }

        return false
    }

    private func cycleStatus(_ rowID: String) {
        guard let index = rowIndex(rowID) else {
            return
        }

        rows[index].kind = rows[index].kind.next
        errorMessage = nil
    }

    private func updateText(
        rowID: String,
        text: String
    ) {
        guard let index = rowIndex(rowID) else {
            return
        }

        rows[index].text = text
        rows[index].creation = text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty
        normalizeVisibleRows()
        errorMessage = nil
    }

    private func splitRow(
        rowID: String,
        range: NSRange
    ) -> Bool {
        guard let index = rowIndex(rowID) else {
            return false
        }

        let source = rows[index].text as NSString
        guard range.location >= 0,
              NSMaxRange(range) <= source.length
        else {
            return false
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

        rows[index].text = before
        rows[index].creation = before
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        let nextIndex = index + 1
        let targetID: String

        if rows.indices.contains(nextIndex),
           rows[nextIndex].creation,
           rows[nextIndex].text.isEmpty {
            rows[nextIndex].text = after
            rows[nextIndex].creation = after
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                .isEmpty
            targetID = rows[nextIndex].id
        } else {
            let next = DaySpaceEditableTodoEntry(
                id: UUID().uuidString.lowercased(),
                kind: .pending,
                text: after,
                creation: after
                    .trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )
                    .isEmpty
            )
            rows.insert(
                next,
                at: nextIndex
            )
            targetID = next.id
        }

        normalizeVisibleRows()
        requestFocus(
            rowID: targetID,
            offset: 0
        )
        errorMessage = nil
        return true
    }

    private func mergeWithPrevious(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              index > 0
        else {
            return false
        }

        let previousIndex = index - 1
        let previousLength = rows[previousIndex]
            .text.utf16.count
        let merged = rows[previousIndex].text
            + rows[index].text

        rows[previousIndex].text = merged
        rows[previousIndex].creation = merged
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        let targetID = rows[previousIndex].id
        rows.remove(at: index)
        normalizeVisibleRows()
        requestFocus(
            rowID: targetID,
            offset: previousLength
        )
        errorMessage = nil
        return true
    }

    private func mergeWithNext(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              rows.indices.contains(index + 1)
        else {
            return false
        }

        let nextIndex = index + 1
        let next = rows[nextIndex]

        if next.creation,
           next.text.isEmpty {
            return true
        }

        let caretOffset = rows[index].text.utf16.count
        rows[index].text += next.text
        rows[index].creation = rows[index].text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty
        rows.remove(at: nextIndex)
        normalizeVisibleRows()
        requestFocus(
            rowID: rowID,
            offset: caretOffset
        )
        errorMessage = nil
        return true
    }

    private func moveToPrevious(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              index > 0
        else {
            return false
        }

        let previous = rows[index - 1]
        requestFocus(
            rowID: previous.id,
            offset: previous.text.utf16.count
        )
        return true
    }

    private func moveToNext(
        rowID: String
    ) -> Bool {
        guard let index = rowIndex(rowID),
              rows.indices.contains(index + 1)
        else {
            return false
        }

        requestFocus(
            rowID: rows[index + 1].id,
            offset: 0
        )
        return true
    }

    private func pasteMultiline(
        rowID: String,
        range: NSRange,
        text: String
    ) -> Bool {
        guard text.contains("\n")
                || text.contains("\r"),
              let index = rowIndex(rowID)
        else {
            return false
        }

        let source = rows[index].text as NSString
        guard range.location >= 0,
              NSMaxRange(range) <= source.length
        else {
            return false
        }

        let normalized = text.replacingOccurrences(
            of: "\r\n",
            with: "\n"
        )
        .replacingOccurrences(
            of: "\r",
            with: "\n"
        )

        let lines = normalized.components(
            separatedBy: "\n"
        )

        guard lines.count > 1 else {
            return false
        }

        let prefix = source.substring(
            with: NSRange(
                location: 0,
                length: range.location
            )
        )
        let suffix = source.substring(
            from: NSMaxRange(range)
        )

        rows[index].text = prefix + (lines.first ?? "")
        rows[index].creation = rows[index].text
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            .isEmpty

        var inserted: [DaySpaceEditableTodoEntry] = []

        for lineIndex in 1..<lines.count {
            let line = lines[lineIndex]
            let isLast = lineIndex == lines.count - 1
            let rowText = isLast
                ? line + suffix
                : line

            inserted.append(
                DaySpaceEditableTodoEntry(
                    id: UUID().uuidString.lowercased(),
                    kind: .pending,
                    text: rowText,
                    creation: rowText
                        .trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        .isEmpty
                )
            )
        }

        rows.insert(
            contentsOf: inserted,
            at: index + 1
        )

        if let target = inserted.last {
            requestFocus(
                rowID: target.id,
                offset: (lines.last ?? "").utf16.count
            )
        }

        normalizeVisibleRows()
        errorMessage = nil
        return true
    }

    private func rowIndex(
        _ rowID: String
    ) -> Int? {
        rows.firstIndex {
            $0.id == rowID
        }
    }

    private func requestFocus(
        rowID: String,
        offset: Int
    ) {
        focusRequest = DaySpaceTodoFocusRequest(
            token: UUID(),
            rowID: rowID,
            offset: offset
        )
    }

    private func normalizeVisibleRows() {
        let lastContentIndex = rows.lastIndex {
            !$0.text.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty
        }

        let targetCount = max(
            24,
            (lastContentIndex ?? -1) + 2
        )

        while rows.count < targetCount {
            rows.append(
                DaySpaceEditableTodoEntry.creationRow()
            )
        }

        while rows.count > targetCount,
              let last = rows.last,
              last.creation,
              last.text.isEmpty {
            rows.removeLast()
        }
    }

    @MainActor
    private func requestClose() async {
        guard !isSaving else {
            return
        }

        guard isDirty else {
            onClosed()
            return
        }

        await saveAndClose()
    }

    @MainActor
    private func saveAndClose() async {
        guard !isSaving else {
            return
        }

        isSaving = true
        errorMessage = nil
        defer {
            isSaving = false
        }

        do {
            let request = DaySpaceTodoReplaceRequest(
                revision: paper?.revision,
                entries: normalizedEntries
            )
            let body = try JSONEncoder().encode(
                request
            )
            let response: DaySpaceTodoPaperEnvelope =
                try await appModel.api.request(
                    path: "/api/v1/todo/\(date)/\(author.rawValue)",
                    method: "PUT",
                    body: body
                )
            onSaved(response.data)
            onClosed()
        } catch LeileiAPIError.backend(
            _,
            let code,
            _
        ) where code == "TODO_PAPER_CONFLICT" {
            errorMessage =
                "这张纸张已在其他设备修改，请重新打开后再保存。"
        } catch {
            errorMessage = "保存失败，请重试"
        }
    }
}

private struct DaySpaceTodoEditorMark: View {
    let kind: DaySpaceTodoEntryKind

    var body: some View {
        ZStack {
            switch kind {
            case .pending:
                Circle()
                    .stroke(
                        Color.black.opacity(0.42),
                        lineWidth: 1
                    )
                    .frame(
                        width: 14,
                        height: 14
                    )

            case .completed:
                Circle()
                    .fill(
                        Color(
                            white: 0.47
                        )
                    )
                    .frame(
                        width: 14,
                        height: 14
                    )

                Image(systemName: "checkmark")
                    .font(
                        .system(
                            size: 8,
                            weight: .semibold
                        )
                    )
                    .foregroundStyle(Color.white)

            case .record:
                Circle()
                    .fill(
                        Color(
                            white: 0.29
                        )
                    )
                    .frame(
                        width: 8,
                        height: 8
                    )
            }
        }
    }
}
