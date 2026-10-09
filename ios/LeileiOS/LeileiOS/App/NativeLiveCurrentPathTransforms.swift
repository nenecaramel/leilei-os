import Foundation

// Pure snapshot merging; request lifecycle and state remain in AppModel.
enum NativeLiveCurrentPathTransforms {
    static func mergeNativeLiveRefresh(
        existing: NativeLiveCurrentPathSnapshot,
        refreshed: NativeLiveCurrentPathSnapshot
    ) -> NativeLiveCurrentPathSnapshot {
        guard let firstRefreshed = refreshed.messages.first else {
            return refreshed
        }

        let existingIndexByID = Dictionary(
            uniqueKeysWithValues:
                existing.messages.enumerated().map {
                    ($0.element.id, $0.offset)
                }
        )

        let prefixEndIndex: Int?
        if let sameMessageIndex =
            existingIndexByID[firstRefreshed.id] {
            prefixEndIndex = sameMessageIndex - 1
        } else if let parentMessageID =
                    firstRefreshed.parentMessageId,
                  let parentIndex =
                    existingIndexByID[parentMessageID] {
            prefixEndIndex = parentIndex
        } else {
            prefixEndIndex = nil
        }

        guard let prefixEndIndex,
              prefixEndIndex >= 0 else {
            return refreshed
        }

        let preservedPrefix =
            Array(existing.messages[0...prefixEndIndex])

        return NativeLiveCurrentPathSnapshot(
            conversationId: refreshed.conversationId,
            title: refreshed.title,
            currentHeadMessageId: refreshed.currentHeadMessageId,
            updatedAt: refreshed.updatedAt,
            syncToken: refreshed.syncToken,
            truncated: existing.truncated,
            olderCursor: existing.olderCursor,
            resetRequired: false,
            messages: preservedPrefix + refreshed.messages,
            failedTurn: refreshed.failedTurn
        )
    }

    static func mergeNativeLiveDelta(
        existing: NativeLiveCurrentPathSnapshot,
        delta: NativeLiveCurrentPathSnapshot
    ) -> NativeLiveCurrentPathSnapshot {
        let known = Set(existing.messages.map(\.id))
        let appended = delta.messages.filter {
            !known.contains($0.id)
        }
        return NativeLiveCurrentPathSnapshot(
            conversationId: delta.conversationId,
            title: delta.title,
            currentHeadMessageId: delta.currentHeadMessageId,
            updatedAt: delta.updatedAt,
            syncToken: delta.syncToken,
            truncated: existing.truncated,
            olderCursor: existing.olderCursor,
            resetRequired: false,
            messages: existing.messages + appended,
            failedTurn: delta.failedTurn
        )
    }
}
