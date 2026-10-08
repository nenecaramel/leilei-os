import Foundation

// Shared value transformation only. Each detail page owns requests and paging state.
enum DiaryCommentPaging {
    static func reconcile(
        _ page: DiaryCommentListData,
        into diary: inout DiaryEntry,
        replaceVisiblePage: Bool
    ) {
        let existing =
            replaceVisiblePage
                ? []
                : (diary.comments ?? [])
        let existingIDs = Set(existing.map(\.id))
        let incoming = page.comments.filter {
            !existingIDs.contains($0.id)
        }

        var combined =
            replaceVisiblePage
                ? page.comments
                : incoming + existing
        combined.sort {
            if $0.createdAt == $1.createdAt {
                return $0.id < $1.id
            }
            return $0.createdAt < $1.createdAt
        }

        diary.comments = combined
        diary.commentsMetadata = DiaryCommentsMetadata(
            count: page.metadata.count,
            returned: combined.count,
            truncated: page.metadata.hasMore
        )
    }
}
