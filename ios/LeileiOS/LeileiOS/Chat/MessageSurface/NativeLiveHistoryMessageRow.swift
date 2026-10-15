import SwiftUI
import UIKit

struct NativeLiveHistorySnapshotRow: View {
    @Environment(\.chatTheme) private var chatTheme
    @Environment(\.nativeLiveCopyFeedback) private var copyFeedback
    let message: NativeLiveConversationHistoryMessage
    let timeZone: String

    private var presentation: NativeLiveMessagePresentation {
        NativeLiveMessagePresentationProjector.project(.history(message))
    }

    var body: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                if chatTheme == .iMessage {
                    Color.clear.frame(width: ChatPresentationLayout.iMessageUserLeadingClearance)
                    NativeLiveIMessageTextBubbleList(presentation: presentation, side: .outgoing)
                        .textSelection(.enabled)
                        .frame(maxWidth:.infinity,alignment:.trailing)
                } else {
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
            }
        } else {
            VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
                if chatTheme == .iMessage {
                    NativeLiveIMessageTextBubbleList(
                        presentation: presentation,
                        side: .incoming,
                        timestamp: MessageTimestampFormatter.string(
                            from: message.time,
                            timeZoneIdentifier: timeZone
                        ),
                        onCopy: { text in
                            UIPasteboard.general.string = text
                            copyFeedback("Message copied")
                        }
                    )
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
