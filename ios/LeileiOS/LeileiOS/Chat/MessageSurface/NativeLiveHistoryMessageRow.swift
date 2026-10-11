import SwiftUI

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
                NativeLiveMessagePresentationView(presentation: presentation)
                .textSelection(.enabled)

                Text(
                    MessageTimestampFormatter.string(
                        from: message.time,
                        timeZoneIdentifier: timeZone
                    )
                )
                .font(.system(size: 13.5))
                .tracking(0.12)
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
