import Foundation

enum DaySpaceTodoSearchSupport {
    static func completeTodoSearchResults(
        papers: [LeileiExportTodoPaperSnapshot],
        query: String
    ) -> [DaySpaceTodoSearchEntry] {
        let needle = normalizedTodoSearchText(query)

        struct Candidate {
            let entry: DaySpaceTodoSearchEntry
            let paperUpdatedAt: String
            let position: Int
        }

        var candidates: [Candidate] = []

        for paper in papers {
            guard let author =
                    DaySpaceAuthor(rawValue: paper.author) else {
                continue
            }

            for (position, rawEntry) in paper.entries.enumerated() {
                guard let kind =
                        DaySpaceTodoEntryKind(
                            rawValue: rawEntry.kind
                        ),
                      normalizedTodoSearchText(
                          rawEntry.text
                      ).contains(needle) else {
                    continue
                }

                candidates.append(
                    Candidate(
                        entry: DaySpaceTodoSearchEntry(
                            entryID: rawEntry.id,
                            date: paper.date,
                            author: author,
                            kind: kind,
                            text: rawEntry.text,
                            snippet: rawEntry.text
                        ),
                        paperUpdatedAt: paper.updatedAt,
                        position: position
                    )
                )
            }
        }

        return candidates.sorted {
            if $0.entry.date != $1.entry.date {
                return $0.entry.date > $1.entry.date
            }
            if $0.paperUpdatedAt != $1.paperUpdatedAt {
                return $0.paperUpdatedAt > $1.paperUpdatedAt
            }
            if $0.position != $1.position {
                return $0.position < $1.position
            }
            return $0.entry.entryID < $1.entry.entryID
        }
        .map(\.entry)
    }

    private static func normalizedTodoSearchText(
        _ value: String
    ) -> String {
        value
            .precomposedStringWithCanonicalMapping
            .lowercased()
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    static func todoSearchPath(for query: String) -> String {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "limit", value: "51"),
        ]
        return "/api/v1/todo/search?\(components.percentEncodedQuery ?? "")"
    }
}
