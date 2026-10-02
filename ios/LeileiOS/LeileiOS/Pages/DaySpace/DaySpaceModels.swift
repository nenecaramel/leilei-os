import SwiftUI
import UIKit

struct DaySpaceTodoCreateSelection: Identifiable {
    let id = UUID()
    let date: String
    let unavailableAuthors: [DaySpaceAuthor]
}

enum DaySpaceTodoSearchState {
    case idle
    case loading
    case results([DaySpaceTodoSearchEntry])
    case noResults
    case unavailable
}

struct DaySpaceTodoSearchEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoSearchData
}

struct DaySpaceTodoSearchData: Decodable {
    let entries: [DaySpaceTodoSearchEntry]
    let metadata: DaySpaceTodoSearchMetadata
}

struct DaySpaceTodoSearchMetadata: Decodable {
    let count: Int
    let author: DaySpaceAuthor?
}

struct DaySpaceTodoSearchEntry: Decodable, Identifiable {
    let entryID: String
    let date: String
    let author: DaySpaceAuthor
    let kind: DaySpaceTodoEntryKind
    let text: String
    let snippet: String

    var id: String {
        "\(date):\(author.rawValue):\(entryID)"
    }

    enum CodingKeys: String, CodingKey {
        case date
        case author
        case kind
        case text
        case snippet
        case entryID = "entry_id"
    }
}

struct DaySpaceTodoFocusRequest: Equatable {
    let token: UUID
    let rowID: String
    let offset: Int
}

enum DaySpaceDiscoveryState: Equatable {
    case loading
    case ready
    case unavailable
}

enum DaySpaceModuleState<Value> {
    case loading(Value?)
    case ready(Value)
    case error(Value?)

    var value: Value? {
        switch self {
        case .loading(let value), .error(let value):
            return value
        case .ready(let value):
            return value
        }
    }

    var isLoading: Bool {
        if case .loading = self {
            return true
        }
        return false
    }

    var isError: Bool {
        if case .error = self {
            return true
        }
        return false
    }

    var isErrorWithoutValue: Bool {
        if case .error(nil) = self {
            return true
        }
        return false
    }
}

enum DaySpacePaperSelection: Identifiable {
    case todo(DaySpaceTodoPaper)
    case diary(DaySpaceDiary)

    var id: String {
        switch self {
        case .todo(let paper):
            return "todo:\(paper.date):\(paper.author.rawValue)"
        case .diary(let diary):
            return "diary:\(diary.id)"
        }
    }

    var density: Int {
        switch self {
        case .todo(let paper):
            return max(1, paper.entries.count)

        case .diary(let diary):
            let length = diary.title.utf16.count
                + diary.content.utf16.count
            return max(
                2,
                min(
                    6,
                    Int(ceil(Double(length) / 44.0))
                )
            )
        }
    }

    var authorLabel: String {
        switch self {
        case .todo(let paper):
            return paper.author.rawValue
        case .diary(let diary):
            return diary.author?.rawValue ?? "—"
        }
    }
}

enum DaySpaceAuthor: String, Codable, CaseIterable, Identifiable {
    case L
    case G
    case C

    var id: String { rawValue }
}

enum DaySpaceTodoEntryKind: String, Codable {
    case pending
    case completed
    case record

    var next: DaySpaceTodoEntryKind {
        switch self {
        case .pending:
            return .completed
        case .completed:
            return .record
        case .record:
            return .pending
        }
    }
}

struct DaySpaceTodoEntry: Codable, Identifiable {
    let id: String
    let kind: DaySpaceTodoEntryKind
    let text: String
}

struct DaySpaceTodoPaper: Codable, Identifiable {
    let author: DaySpaceAuthor
    let date: String
    let revision: Int
    let entries: [DaySpaceTodoEntry]

    var id: String {
        "\(date):\(author.rawValue)"
    }
}

struct DaySpaceTodoPapers: Codable {
    var L: DaySpaceTodoPaper?
    var G: DaySpaceTodoPaper?
    var C: DaySpaceTodoPaper?

    subscript(author: DaySpaceAuthor) -> DaySpaceTodoPaper? {
        get {
            switch author {
            case .L: return L
            case .G: return G
            case .C: return C
            }
        }
        set {
            switch author {
            case .L: L = newValue
            case .G: G = newValue
            case .C: C = newValue
            }
        }
    }
}

struct DaySpaceTodoDay: Codable {
    let date: String
    var papers: DaySpaceTodoPapers

    var visiblePapers: [DaySpaceTodoPaper] {
        DaySpaceAuthor.allCases.compactMap { author in
            guard let paper = papers[author],
                  !paper.entries.isEmpty
            else {
                return nil
            }
            return paper
        }
    }

    mutating func setPaper(
        _ paper: DaySpaceTodoPaper?,
        for author: DaySpaceAuthor
    ) {
        papers[author] = paper
    }
}

struct DaySpaceDiary: Codable, Identifiable {
    let id: String
    let title: String
    let content: String
    let date: String
    let author: DaySpaceAuthor?
    let tags: [String]
    let mood: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case author
        case tags
        case mood
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct DaySpaceDatesEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDatesData
}

struct DaySpaceDatesData: Decodable {
    let dates: [String]
}

struct DaySpaceTodoDayEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoDay
}

struct DaySpaceTodoPaperEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceTodoPaper
}

struct DaySpaceDiaryDayEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDiaryDay
}

struct DaySpaceDiaryDay: Decodable {
    let date: String
    let diaries: [DaySpaceDiary]
}

struct DaySpaceDiaryEnvelope: Decodable {
    let success: Bool
    let data: DaySpaceDiary
}

struct DaySpaceDiaryUpdateRequest: Encodable {
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let author: DaySpaceAuthor
}

struct DaySpaceTodoReplaceRequest: Encodable {
    let revision: Int?
    let entries: [DaySpaceTodoEntry]

    enum CodingKeys: String, CodingKey {
        case revision
        case entries
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(
            keyedBy: CodingKeys.self
        )

        if let revision {
            try container.encode(
                revision,
                forKey: .revision
            )
        } else {
            try container.encodeNil(
                forKey: .revision
            )
        }

        try container.encode(
            entries,
            forKey: .entries
        )
    }
}

struct DaySpaceEditableTodoEntry: Identifiable {
    let id: String
    var kind: DaySpaceTodoEntryKind
    var text: String
    var creation: Bool

    static func initialRows(
        author: DaySpaceAuthor,
        entries: [DaySpaceTodoEntry]
    ) -> [DaySpaceEditableTodoEntry] {
        var rows = entries.map {
            DaySpaceEditableTodoEntry(
                id: $0.id,
                kind: $0.kind,
                text: $0.text,
                creation: false
            )
        }

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
                creationRow()
            )
        }

        return rows
    }

    static func creationRow() -> DaySpaceEditableTodoEntry {
        DaySpaceEditableTodoEntry(
            id: UUID().uuidString.lowercased(),
            kind: .pending,
            text: "",
            creation: true
        )
    }
}
