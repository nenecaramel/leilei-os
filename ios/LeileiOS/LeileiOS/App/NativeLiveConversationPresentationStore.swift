import Foundation

extension AppModel {
    func reconcileNativeLivePresentation() {
        let rows = nativeLivePresentationAssembler.project(snapshot:nativeLiveCurrentPath,historySnapshot:nativeLiveHistorySnapshot,
            pendingOperation:nativeLivePendingOperation,runtimeSurface:nativeLiveRuntimeSurface,
            backgroundRuntimeSurfaces:nativeLiveBackgroundRuntimeSurfaces,identities:nativeLiveTurnIdentities,now:Date())
        if rows != nativeLiveConversationRows {
            nativeLiveConversationRows = rows
        }
        for row in rows {
            if let turn = row.assistant { nativeLiveMessageUIState[row.id].pendingInputChanged(turn.hasPendingInput) }
        }
        let liveIDs = Set(rows.map(\.id))
        nativeLiveMessageUIState.prune(retaining:liveIDs)
        nativeLiveTurnIdentities.prune(retaining:liveIDs)
    }
    func bindNativeLivePresentation(_ operation: NativeLivePendingOperation?, prepared: NativeLivePrepareResult) {
        guard let operation else { return }
        nativeLiveTurnIdentities.bind(operation,prepared:prepared,snapshot:nativeLiveCurrentPath,stableIDs:nativeLivePresentationAssembler.pendingIDs(operation,snapshot:nativeLiveCurrentPath,identities:nativeLiveTurnIdentities))
        reconcileNativeLivePresentation()
    }
}
