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
            if !turn.header.isEmpty || turn.murmurText != nil {
                NativeLiveTurnActivityView(projection:turn.activityProjection,
                    timestampText:turn.timestamp.map { MessageTimestampFormatter.string(from:$0) },header:turn.header,
                    murmurText:turn.murmurText,
                    expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 }),
                    onResolveInteraction:onResolveInteraction)
            } else if let timestamp = turn.timestamp {
                Text(MessageTimestampFormatter.string(from:timestamp)).font(.system(size:13.5)).foregroundStyle(.secondary)
            }
            NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)
            MindWriteIndicator(items:mindWrites)
            AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)
            HStack(spacing:ChatPresentationLayout.actionSpacing) {
                if let text = turn.copyText {
                    Button { onCopyMessage(text) } label: { Image(systemName:isCopied ? "checkmark" : "square.on.square").frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter) }
                }
                if turn.canRetry, let user = turn.parentUserMessageID {
                    Button { onRetryMessage(user) } label: { Image(systemName:"arrow.clockwise").frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter) }.disabled(isTurnInFlight)
                }
            }.font(.system(size:14)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top,ChatPresentationLayout.actionTopInset)
        }
        .frame(maxWidth:.infinity,alignment:.leading)
        .task(id:turn.canonicalMessageID) {
            guard let id = turn.canonicalMessageID else { return }
            await appModel.refreshMindWrites(messageID:id)
            if let user = turn.parentUserMessageID { await appModel.refreshAlbumSaves(userMessageID:user,force:isCurrentHead) }
        }
    }
    private var mindWrites: [MindWriteIndicatorItem] {
        guard let id = turn.canonicalMessageID, let value = appModel.mindWritesByMessageID[id] else { return [] }
        return value.kinds.map { .init(kind:$0.kind.displayName,count:$0.count) }
    }
}
