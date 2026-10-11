import SwiftUI

// Presentation only: callbacks and identity continue to come from the row owner.
@ViewBuilder func nativeLiveAssistantActions(
    turn: NativeLiveAssistantTurnPresentation,
    isTurnInFlight: Bool,
    isCopied: Bool,
    onCopyMessage: @escaping (String) -> Void,
    onRetryMessage: @escaping (String) -> Void
) -> some View {
    HStack(spacing:ChatPresentationLayout.actionSpacing) {
        if let text = turn.copyText {
            Button { onCopyMessage(text) } label: { Image(systemName:isCopied ? "checkmark" : "square.on.square").rotationEffect(.degrees(isCopied ? 0 : 180)).frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter,alignment:.leading) }
        }
        if turn.canRetry, let user = turn.parentUserMessageID {
            Button { onRetryMessage(user) } label: { Image(systemName:"arrow.clockwise").rotationEffect(.degrees(20)).frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter,alignment:.leading) }.disabled(isTurnInFlight)
        }
        if let timestamp = turn.visibleTimestamp {
            Text(MessageTimestampFormatter.string(from:timestamp))
                .font(.system(size:12)).tracking(0.12)
                .foregroundStyle(.secondary)
        }
    }.font(.system(size:14)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top,ChatPresentationLayout.actionTopInset)
}
