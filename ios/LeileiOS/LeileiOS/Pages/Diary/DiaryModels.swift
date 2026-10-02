import SwiftUI
import UIKit

enum DiaryAuthorFilter: String, CaseIterable {
    case any
    case l = "L"
    case g = "G"
    case c = "C"

    var author: String? {
        self == .any ? nil : rawValue
    }
}

enum DiaryTimeFilter {
    case anyTime
    case custom

    static var defaultStartDate: Date {
        Calendar.current.date(byAdding: .month, value: -1, to: .now) ?? .now
    }
}

enum DiaryArchiveLoadState {
    case loading
    case unavailable(String)
    case loaded([DiaryEntry])
}

enum DiaryCommentEditorMode: Identifiable {
    case create
    case edit(DiaryComment)

    var id: String {
        switch self {
        case .create:
            return "create"
        case .edit(let comment):
            return "edit:\(comment.id)"
        }
    }

    var comment: DiaryComment? {
        switch self {
        case .create:
            return nil
        case .edit(let comment):
            return comment
        }
    }
}

enum DiaryEditorField {
    case title
    case content
}

struct DiaryCreateRequest: Encodable {
    let title: String
    let content: String
    let date: String
    let tags: [String]
    let mood: String?
    let author: String

    static func parseTags(_ value: String) -> [String] {
        value
            .split(whereSeparator: { $0 == "," || $0 == "，" })
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    static func normalizedOptional(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}

struct DiaryCommentCreateRequest: Encodable {
    let author: String
    let content: String
    let idempotencyKey: String

    enum CodingKeys: String, CodingKey {
        case author
        case content
        case idempotencyKey = "idempotency_key"
    }
}

struct DiaryCommentCreateEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentCreateData
}

struct DiaryCommentCreateData: Decodable {
    let comment: DiaryComment
}

struct DiaryCommentEnvelope: Decodable {
    let success: Bool
    let data: DiaryComment
}

struct DiaryCommentListEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentListData
}

struct DiaryCommentListData: Decodable {
    let comments: [DiaryComment]
    let metadata: DiaryCommentListMetadata
}

struct DiaryCommentListMetadata: Decodable {
    let count: Int
    let returned: Int
    let hasMore: Bool
    let nextBefore: String?

    enum CodingKeys: String, CodingKey {
        case count
        case returned
        case hasMore = "has_more"
        case nextBefore = "next_before"
    }
}

struct DiaryCommentUpdateRequest: Encodable {
    let expectedRevision: Int
    let content: String

    enum CodingKeys: String, CodingKey {
        case content
        case expectedRevision = "expected_revision"
    }
}

struct DiaryCommentDeleteRequest: Encodable {
    let expectedRevision: Int

    enum CodingKeys: String, CodingKey {
        case expectedRevision = "expected_revision"
    }
}

struct DiaryCommentDeleteEnvelope: Decodable {
    let success: Bool
    let data: DiaryCommentDeleteData
}

struct DiaryCommentDeleteData: Decodable {
    let commentID: String
    let deleted: Bool

    enum CodingKeys: String, CodingKey {
        case deleted
        case commentID = "comment_id"
    }
}

struct DiarySuccessEnvelope: Decodable {
    let success: Bool
}

enum DiaryDetailLoadState {
    case loading
    case unavailable(String)
    case loaded(DiaryEntry)
}

enum DiaryLoadState {
    case loading
    case authRequired(String)
    case unavailable(String)
    case loaded([DiaryEntry])
}

struct DiaryListEnvelope: Decodable {
    let success: Bool
    let data: DiaryListData
}

struct DiaryEntryEnvelope: Decodable {
    let success: Bool
    let data: DiaryEntry
}

struct DiaryListData: Decodable {
    let diaries: [DiaryEntry]
    let metadata: DiaryListMetadata
}

struct DiaryListMetadata: Decodable {
    let count: Int
}

struct DiaryEntry: Decodable, Identifiable {
    let id: String
    let title: String
    let content: String?
    let date: String
    let tags: [String]
    let mood: String?
    let createdAt: String
    let updatedAt: String
    let author: String?
    var comments: [DiaryComment]?
    var commentsMetadata: DiaryCommentsMetadata?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case content
        case date
        case tags
        case mood
        case author
        case comments
        case commentsMetadata = "comments_metadata"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum DiaryCommentScope: Equatable {
    case active
    case archived
}

struct DiaryComment: Decodable, Identifiable {
    let id: String
    let diaryID: String
    let author: String
    let content: String
    let revision: Int
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case author
        case content
        case revision
        case diaryID = "diary_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct DiaryCommentsMetadata: Decodable {
    let count: Int
    let returned: Int
    let truncated: Bool
}

struct DiaryMonthGroup: Identifiable {
    let id: String
    let title: String
    let diaries: [DiaryEntry]

    static func make(from diaries: [DiaryEntry]) -> [DiaryMonthGroup] {
        var order: [String] = []
        var grouped: [String: [DiaryEntry]] = [:]

        for diary in diaries {
            let key = DiaryDate.monthKey(diary.date)
            if grouped[key] == nil {
                order.append(key)
                grouped[key] = []
            }
            grouped[key, default: []].append(diary)
        }

        return order.map { key in
            DiaryMonthGroup(
                id: key,
                title: DiaryDate.formatMonth(key),
                diaries: grouped[key] ?? []
            )
        }
    }
}
