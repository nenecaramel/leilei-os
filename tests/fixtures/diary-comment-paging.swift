import Foundation

private func comment(_ id: String, _ time: String = "2026-10-01", _ content: String = "original") -> DiaryComment {
    DiaryComment(id: id, diaryID: "diary", author: "L", content: content, revision: 1, createdAt: time, updatedAt: time)
}
private func diary(_ comments: [DiaryComment]?) -> DiaryEntry {
    DiaryEntry(id: "diary", title: "title", content: nil, date: "2026-10-01", tags: [], mood: nil, createdAt: "created", updatedAt: "updated", author: nil, comments: comments, commentsMetadata: nil)
}
private func check(_ state: DiaryDetailLoadState, _ ids: [String], _ contents: [String], _ total: Int, _ more: Bool) {
    guard case .loaded(let value) = state else { fatalError("expected loaded") }
    precondition(value.comments?.map(\.id) == ids)
    precondition(value.comments?.map(\.content) == contents)
    precondition(value.commentsMetadata?.count == total)
    precondition(value.commentsMetadata?.returned == ids.count)
    precondition(value.commentsMetadata?.truncated == more)
    precondition(value.id == "diary" && value.title == "title" && value.updatedAt == "updated")
}

@main struct Checks {
    static func main() {
        let cases: [([DiaryComment]?, [DiaryComment], Bool, [String], [String])] = [
            (nil, [comment("b"), comment("a")], true, ["a", "b"], ["original", "original"]),
            ([comment("old")], [comment("new")], true, ["new"], ["original"]),
            ([comment("b")], [comment("a"), comment("b", "2026-10-01", "stale")], false, ["a", "b"], ["original", "original"]),
            ([comment("z", "2026-10-02")], [comment("a", "2026-10-01")], false, ["a", "z"], ["original", "original"]),
            ([comment("a")], [], false, ["a"], ["original"]),
            (nil, [], false, [], []),
            (nil, [comment("a"), comment("a")], false, ["a", "a"], ["original", "original"]),
        ]
        for (existing, incoming, replace, ids, contents) in cases {
            let page = DiaryCommentListData(comments: incoming, metadata: DiaryCommentListMetadata(count: 99, returned: 42, hasMore: true, nextBefore: "opaque+/cursor="))
            var active = Owner0(state: .loaded(diary(existing)))
            var archive = Owner1(state: .loaded(diary(existing)))
            active.reconcileCommentPage(page, replaceVisiblePage: replace)
            archive.reconcileCommentPage(page, replaceVisiblePage: replace)
            check(active.state, ids, contents, 99, true)
            check(archive.state, ids, contents, 99, true)
            precondition(active.commentsHaveMore && archive.commentsHaveMore)
            precondition(active.commentNextBefore == "opaque+/cursor=" && archive.commentNextBefore == active.commentNextBefore)
            // A repeated overlapping response must preserve the current visible values.
            active.reconcileCommentPage(page, replaceVisiblePage: false)
            archive.reconcileCommentPage(page, replaceVisiblePage: false)
            check(active.state, ids, contents, 99, true)
            check(archive.state, ids, contents, 99, true)
        }
        let empty = DiaryCommentListData(comments: [], metadata: DiaryCommentListMetadata(count: 0, returned: 0, hasMore: false, nextBefore: nil))
        var active = Owner0(state: .loaded(diary([comment("a")])), commentsHaveMore: true, commentNextBefore: "old")
        var archive = Owner1(state: .loaded(diary([comment("a")])), commentsHaveMore: true, commentNextBefore: "old")
        active.reconcileCommentPage(empty, replaceVisiblePage: true)
        archive.reconcileCommentPage(empty, replaceVisiblePage: true)
        check(active.state, [], [], 0, false)
        check(archive.state, [], [], 0, false)
        precondition(!active.commentsHaveMore && !archive.commentsHaveMore && active.commentNextBefore == nil && archive.commentNextBefore == nil)
        active.state = .loading
        archive.state = .unavailable("Failed")
        active.reconcileCommentPage(empty, replaceVisiblePage: false)
        archive.reconcileCommentPage(empty, replaceVisiblePage: false)
        guard case .loading = active.state, case .unavailable("Failed") = archive.state else { fatalError("non-loaded state changed") }
        print("Diary paging: 16 cases PASS")
    }
}
