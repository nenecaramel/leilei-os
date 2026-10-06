import Foundation

extension ChatView {
    var isConversationLoading: Bool {
        guard pendingOperation == nil,
              !isDraftConversation,
              appModel.isAuthenticated,
              appModel.activeNativeLiveConversationID != nil,
              appModel.nativeLiveCurrentPath == nil else {
            return false
        }

        return appModel.chatSyncState == .idle
            || appModel.chatSyncState == .loading
    }

    func refreshConversationPage() async {
        await appModel.refreshNativeLiveConversationHistorySnapshot()
        await appModel.refreshNativeLiveCurrentPath()
        if let conversationID =
                appModel.activeNativeLiveConversationID {
            appModel.beginNativeLiveConversationHeadObservation(
                conversationID: conversationID
            )
        }
    }
}
