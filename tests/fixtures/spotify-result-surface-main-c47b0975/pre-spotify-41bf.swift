import SwiftUI

// The row draws a single pre-reconciled turn. It never chooses runtime/canonical owners.
struct NativeLiveAssistantTurnRow: View {
    @EnvironmentObject private var appModel: AppModel
    let turn: NativeLiveAssistantTurnPresentation
    let isCurrentHead: Bool
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
    let onRetryMessage: (String) -> Void
    let onResolveInteraction: (NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws -> Void
    var body: some View {
        VStack(alignment:.leading,spacing:ChatPresentationLayout.assistantSpacing) {
            activityArea
            NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)
            MindWriteIndicator(items:mindWrites)
            AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)
            nativeLiveAssistantActions(turn:turn,isTurnInFlight:isTurnInFlight,isCopied:isCopied,
                onCopyMessage:onCopyMessage,onRetryMessage:onRetryMessage)
        }
        .frame(maxWidth:.infinity,alignment:.leading)
        .task(id:turn.canonicalMessageID) {
            guard let id = turn.canonicalMessageID else { return }
            await appModel.refreshMindWrites(messageID:id)
            if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }
        }
    }
    @ViewBuilder private var activityArea: some View {
        if !turn.header.isEmpty || turn.murmurText != nil {
            NativeLiveTurnActivityView(projection:turn.activityProjection,
                timestampText:turn.timestamp.map { MessageTimestampFormatter.string(from:$0) },header:turn.header,
                murmurText:turn.murmurText,
                expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 }),
                onResolveInteraction:onResolveInteraction)
        } else if let timestamp = turn.timestamp {
            Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:13.5)).foregroundStyle(.secondary)
        }
    }
    private var mindWrites: [MindWriteIndicatorItem] {
        guard let id = turn.canonicalMessageID, let value = appModel.mindWritesByMessageID[id] else { return [] }
        return value.kinds.map { .init(kind:$0.kind.displayName,count:$0.count) }
    }
}
