import Foundation

struct LeileiExportSnapshot: Decodable, Sendable {
    let schemaVersion: Int
    let data: LeileiExportDataSnapshot

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case data
    }
}

struct LeileiExportDataSnapshot: Decodable, Sendable {
    let diary: [LeileiExportDiarySnapshot]?
    let todo: [LeileiExportTodoPaperSnapshot]?
}

struct LeileiExportDiarySnapshot:
    Decodable,
    Sendable,
    Identifiable {
    let id: String
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let author: String?
    let status: String
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case tags
        case mood
        case author
        case status
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct LeileiExportTodoPaperSnapshot:
    Decodable,
    Sendable {
    let date: String
    let author: String
    let revision: Int
    let updatedAt: String
    let entries: [LeileiExportTodoEntrySnapshot]

    enum CodingKeys: String, CodingKey {
        case date
        case author
        case revision
        case updatedAt = "updated_at"
        case entries
    }
}

struct LeileiExportTodoEntrySnapshot:
    Decodable,
    Sendable,
    Identifiable {
    let id: String
    let kind: String
    let text: String
}
