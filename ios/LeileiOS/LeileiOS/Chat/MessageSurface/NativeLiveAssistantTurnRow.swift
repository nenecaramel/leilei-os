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
        VStack(alignment:.leading,spacing:6) {
            if !turn.header.isEmpty {
                NativeLiveTurnActivityView(projection:turn.activityProjection,
                    timestampText:MessageTimestampFormatter.string(from:turn.timestamp),header:turn.header,
                    expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 }),
                    onResolveInteraction:onResolveInteraction)
            } else {
                Text(MessageTimestampFormatter.string(from:turn.timestamp)).font(.system(size:13.5)).foregroundStyle(.secondary)
            }
            NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)
            MindWriteIndicator(items:mindWrites)
            AlbumSaveIndicator(count:turn.parentUserMessageID.flatMap { appModel.albumSavesByUserMessageID[$0]?.total } ?? 0)
            HStack(spacing:12) {
                if let text = turn.copyText {
                    Button { onCopyMessage(text) } label: { Image(systemName:isCopied ? "checkmark" : "square.on.square").frame(width:22,height:22) }
                }
                if turn.canRetry, let user = turn.parentUserMessageID {
                    Button { onRetryMessage(user) } label: { Image(systemName:"arrow.clockwise").frame(width:22,height:22) }.disabled(isTurnInFlight)
                }
            }.font(.system(size:14)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top,7)
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
