import Foundation

struct DiaryNavigationTarget:
    Hashable,
    Identifiable,
    Sendable {
    let diaryID: String
    let scope: String

    var id: String {
        "\(scope):\(diaryID)"
    }
}

struct DaySpaceNavigationTarget:
    Hashable,
    Identifiable,
    Sendable {
    let date: String
    let author: String?

    var id: String {
        "\(date):\(author ?? "-")"
    }
}
