import SwiftUI
import Foundation

struct NativeLiveMessageRow: View {
    @EnvironmentObject private var appModel: AppModel
    let row: NativeLiveConversationRowPresentation
    let isCurrentHead: Bool
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void
    let onResolveInteraction: (NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws -> Void

    var body: some View {
        if row.isHistoryDivider {
            NativeLiveHistoryForkDivider()
        } else if let history = row.historyMessage {
            NativeLiveHistorySnapshotRow(message:history,timeZone:row.historyTimeZone ?? "UTC")
        } else if let turn = row.assistant {
            NativeLiveAssistantTurnRow(turn:turn,isCurrentHead:isCurrentHead,isTurnInFlight:isTurnInFlight,isCopied:isCopied,
                onCopyMessage:onCopyMessage,onRetryMessage:onRetryMessage,onResolveInteraction:onResolveInteraction)
        } else if let user = row.user {
            HStack(alignment:.top,spacing:0) {
                Spacer(minLength:ChatPresentationLayout.userLeadingClearance)
                NativeLiveUserMessagePresentationView(presentation:user,isVoiceTranscriptRevealed:Binding(
                    get:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion },
                    set:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion = $0 }),
                    onEdit:row.userBacking.map { message in { onEditMessage(message) } },onCopy:onCopyMessage,isDisabled:isTurnInFlight)
            }
        }
    }
}

struct NativeLiveHistorySnapshotRow: View {
    let message: NativeLiveConversationHistoryMessage
    let timeZone: String

    private var presentation: NativeLiveMessagePresentation {
        NativeLiveMessagePresentationProjector.project(.history(message))
    }

    var body: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                Spacer(minLength: ChatPresentationLayout.userLeadingClearance)

                NativeLiveMessagePresentationView(presentation: presentation)
                .textSelection(.enabled)
                .padding(.horizontal, ChatPresentationLayout.bubbleHorizontalInset)
                .padding(.vertical, ChatPresentationLayout.bubbleVerticalInset)
                .background(
                    Color.chatSoftFill,
                    in: RoundedRectangle(
                        cornerRadius: ChatPresentationLayout.bubbleRadius,
                        style: .continuous
                    )
                )
            }
        } else {
            VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
                Text(
                    MessageTimestampFormatter.string(
                        from: message.time,
                        timeZoneIdentifier: timeZone
                    )
                )
                .font(.system(size: 13.5))
                .tracking(0.12)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)

                NativeLiveMessagePresentationView(presentation: presentation)
                .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}


struct NativeLiveHistoryForkDivider: View {
    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(Color.secondary.opacity(0.18))
                .frame(height: 0.5)

            Text("Forked into LeileiOS")
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(.secondary)
                .fixedSize()

            Rectangle()
                .fill(Color.secondary.opacity(0.18))
                .frame(height: 0.5)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
