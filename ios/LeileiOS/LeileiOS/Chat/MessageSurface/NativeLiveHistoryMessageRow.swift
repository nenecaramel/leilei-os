import SwiftUI

struct NativeLiveHistorySnapshotRow: View {
    @Environment(\.chatTheme) private var chatTheme
    let message: NativeLiveConversationHistoryMessage
    let timeZone: String

    private var presentation: NativeLiveMessagePresentation {
        NativeLiveMessagePresentationProjector.project(.history(message))
    }

    var body: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                Spacer(minLength: chatTheme == .iMessage ? ChatPresentationLayout.iMessageUserLeadingClearance : ChatPresentationLayout.userLeadingClearance)

                if chatTheme == .iMessage {
                    NativeLiveIMessageTextBubbleList(presentation: presentation, side: .outgoing)
                        .textSelection(.enabled)
                } else {
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
            }
        } else {
            VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
                if chatTheme == .iMessage {
                    NativeLiveIMessageTextBubbleList(presentation: presentation, side: .incoming)
                        .textSelection(.enabled)
                } else {
                    NativeLiveMessagePresentationView(presentation: presentation)
                        .textSelection(.enabled)
                    Text(
                        MessageTimestampFormatter.string(
                            from: message.time,
                            timeZoneIdentifier: timeZone
                        )
                    )
                    .font(.system(size: 12))
                    .tracking(0.12)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
