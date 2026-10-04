import Foundation

extension AppModel {
    func reconcileNativeLivePresentation() {
        nativeLiveConversationRows = nativeLivePresentationAssembler.project(snapshot:nativeLiveCurrentPath,historySnapshot:nativeLiveHistorySnapshot,
            pendingOperation:nativeLivePendingOperation,runtimeSurface:nativeLiveRuntimeSurface,
            backgroundRuntimeSurfaces:nativeLiveBackgroundRuntimeSurfaces,identities:nativeLiveTurnIdentities,now:Date())
        for row in nativeLiveConversationRows {
            if let turn = row.assistant { nativeLiveMessageUIState[row.id].pendingInputChanged(turn.hasPendingInput) }
        }
        let liveIDs = Set(nativeLiveConversationRows.map(\.id))
        nativeLiveMessageUIState.prune(retaining:liveIDs)
        nativeLiveTurnIdentities.prune(retaining:liveIDs)
    }
    func bindNativeLivePresentation(_ operation: NativeLivePendingOperation?, prepared: NativeLivePrepareResult) {
        guard let operation else { return }
        nativeLiveTurnIdentities.bind(operation,prepared:prepared,snapshot:nativeLiveCurrentPath,stableIDs:nativeLivePresentationAssembler.pendingIDs(operation,snapshot:nativeLiveCurrentPath,identities:nativeLiveTurnIdentities))
        reconcileNativeLivePresentation()
    }
}
