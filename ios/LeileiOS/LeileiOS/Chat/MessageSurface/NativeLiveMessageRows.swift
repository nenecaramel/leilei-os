import SwiftUI
import Foundation

struct NativeLiveMessageRow: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.chatTheme) private var chatTheme
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
        } else if let result = row.backgroundResult {
            NativeLiveBackgroundResultRow(result: result, onCopy: onCopyMessage)
        } else if let turn = row.assistant {
            NativeLiveAssistantTurnRow(turn:turn,isCurrentHead:isCurrentHead,isTurnInFlight:isTurnInFlight,isCopied:isCopied,
                onCopyMessage:onCopyMessage,onRetryMessage:onRetryMessage,onResolveInteraction:onResolveInteraction)
        } else if let user = row.user {
            nativeLiveUserMessageRow(row:row,user:user,appModel:appModel,isTurnInFlight:isTurnInFlight,
                leadingClearance: chatTheme == .iMessage ? ChatPresentationLayout.iMessageUserLeadingClearance : ChatPresentationLayout.userLeadingClearance,
                isIMessage: chatTheme == .iMessage,
                onCopyMessage:onCopyMessage,onEditMessage:onEditMessage)
        }
    }
}

 
// The receipt is a read-only delivery, not an editable/retryable provider turn.
private struct NativeLiveBackgroundResultRow: View {
    @Environment(\.chatTheme) private var chatTheme
    let result: NativeLiveBackgroundResultSnapshot
    let onCopy: (String) -> Void

    var body: some View {
        let presentation = NativeLiveMessagePresentationProjector.project(
            .streaming(result.text),
            presentationNamespace: "background:\(result.id)"
        )
        VStack(alignment: .leading, spacing: 6) {
            Text("Background result")
                .font(.caption)
                .foregroundStyle(.secondary)
            if chatTheme == .iMessage {
                NativeLiveIMessageTextBubbleList(
                    presentation: presentation,
                    side: .incoming,
                    timestamp: MessageTimestampFormatter.string(from: result.createdAt),
                    onCopy: onCopy,
                    onRetry: nil,
                    isRetryDisabled: true
                )
            } else {
                NativeLiveMessagePresentationView(presentation: presentation)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
