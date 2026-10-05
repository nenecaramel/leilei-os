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
            Button { onCopyMessage(text) } label: { Image(systemName:isCopied ? "checkmark" : "square.on.square").frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter) }
        }
        if turn.canRetry, let user = turn.parentUserMessageID {
            Button { onRetryMessage(user) } label: { Image(systemName:"arrow.clockwise").frame(width:ChatPresentationLayout.actionDiameter,height:ChatPresentationLayout.actionDiameter) }.disabled(isTurnInFlight)
        }
    }.font(.system(size:14)).foregroundStyle(.secondary).buttonStyle(.plain).padding(.top,ChatPresentationLayout.actionTopInset)
}
