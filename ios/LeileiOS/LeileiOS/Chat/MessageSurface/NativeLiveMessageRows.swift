import SwiftUI
import Foundation

struct NativeLiveMessageRow: View {
    @EnvironmentObject private var appModel: AppModel

    let message: NativeLiveCurrentPathMessage
    let isCurrentHead: Bool
    let presentationSource: NativeLiveMessagePresentationSource
    let showPendingReplacement: Bool
    let replacementRuntimeSurface:
        NativeLiveRuntimeSurfaceState?
    let activityRuntimeSurface:
        NativeLiveRuntimeSurfaceState?
    let onResolveReplacementInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    @State private var isVoiceTranscriptRevealed = false

    var body: some View {
        rowContent
            .task(id: "\(message.id):\(message.status)") {
                guard message.role == "assistant",
                      message.status != "pending",
                      message.status != "streaming" else {
                    return
                }

                await appModel.refreshMindWrites(
                    messageID: message.id
                )
                if let userMessageID = message.parentMessageId {
                    await appModel.refreshAlbumSaves(
                        userMessageID: userMessageID,
                        force: isCurrentHead
                    )
                }
            }
    }

    @ViewBuilder
    private var rowContent: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                Spacer(minLength: 48)

                VStack(alignment: .trailing, spacing: 6) {
                    userMessagePresentation

                    messageStatus
                }
            }
        } else if showPendingReplacement {
            ZStack(alignment: .topLeading) {
                assistantContent
                    .hidden()
                    .accessibilityHidden(true)

                NativeLiveRuntimeAssistantRow(
                    runtimeSurface: replacementRuntimeSurface,
                    onResolveInteraction:
                        onResolveReplacementInteraction
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if message.status == "pending"
                    || message.status == "streaming" {
            AssistantTypingIndicatorRow()
        } else {
            assistantContent
        }
    }

    private var presentation: NativeLiveMessagePresentation {
        NativeLiveMessagePresentationProjector.project(presentationSource)
    }

    private var userMessagePresentation: some View {
        NativeLiveUserMessagePresentationView(presentation: presentation,
                                             isVoiceTranscriptRevealed: $isVoiceTranscriptRevealed,
                                             onEdit:{ onEditMessage(message) },onCopy:onCopyMessage,isDisabled:isTurnInFlight)
    }

    private var isVoiceInputMessage: Bool { presentation.isVoiceInput }
    private var voiceTranscriptText: String? { presentation.copyText }

    private var assistantContent: some View {
        let timestamp = MessageTimestampFormatter.string(
            from: message.completedAt ?? message.createdAt
        )

        return VStack(alignment: .leading, spacing: 6) {
            if displayedActivityProjection.hasContent {
                NativeLiveTurnActivityView(
                    projection: displayedActivityProjection,
                    timestampText: timestamp,
                    onResolveInteraction:
                        onResolveReplacementInteraction
                )
            } else {
                Text(timestamp)
                    .font(.system(size: 13.5))
                    .tracking(0.12)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)
            }

            messageContent
                .textSelection(.enabled)

            messageStatus

            MindWriteIndicator(
                items: mindWriteItems
            )

            AlbumSaveIndicator(
                count: albumSaveCount
            )

            HStack(spacing: 12) {
                if let copyText {
                    Button {
                        onCopyMessage(copyText)
                    } label: {
                        Image(
                            systemName:
                                isCopied
                                ? "checkmark"
                                : "square.on.square"
                        )
                        .rotationEffect(
                            isCopied
                                ? .degrees(0)
                                : .degrees(180)
                        )
                        .frame(width: 22, height: 22)
                    }
                }

                if let targetUserMessageID = message.parentMessageId {
                    Button {
                        onRetryMessage(targetUserMessageID)
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .rotationEffect(.degrees(45))
                            .frame(width: 22, height: 22)
                    }
                    .disabled(isTurnInFlight)
                }
            }
            .font(.system(size: 14, weight: .regular))
            .foregroundStyle(.secondary)
            .buttonStyle(.plain)
            .padding(.top, 7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var messageContent: some View {
        NativeLiveMessagePresentationView(presentation: presentation)
    }

    private var historicalActivityProjection:
        NativeLiveTurnActivityProjection {
        NativeLiveTurnActivityProjection(message: message)
    }

    private var displayedActivityProjection:
        NativeLiveTurnActivityProjection {
        if let activityRuntimeSurface {
            return NativeLiveTurnActivityProjection(
                runtimeSurface: activityRuntimeSurface
            )
        }
        if let prepareID = message.activity?.prepareId,
           let backgroundSurface =
            appModel.nativeLiveBackgroundRuntimeSurfaces[
                prepareID
            ] {
            return NativeLiveTurnActivityProjection(
                runtimeSurface: backgroundSurface
            )
        }
        return historicalActivityProjection
    }

    @ViewBuilder
    private var messageStatus: some View {
        if message.status == "error" {
            Text("Failed")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var copyText: String? { presentation.copyText }

    private var albumSaveCount: Int {
        guard let userMessageID = message.parentMessageId else {
            return 0
        }
        return appModel.albumSavesByUserMessageID[
            userMessageID
        ]?.total ?? 0
    }

    private var mindWriteItems: [MindWriteIndicatorItem] {
        guard let projection =
                appModel.mindWritesByMessageID[message.id] else {
            return []
        }

        return projection.kinds.map {
            MindWriteIndicatorItem(
                kind: $0.kind.displayName,
                count: $0.count
            )
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
                Spacer(minLength: 48)

                NativeLiveMessagePresentationView(presentation: presentation)
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(
                    Color.chatSoftFill,
                    in: RoundedRectangle(
                        cornerRadius: 18,
                        style: .continuous
                    )
                )
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
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


struct NativeLiveOptimisticUserRow: View {
    let source: NativeLiveMessagePresentationSource
    @State private var isVoiceTranscriptRevealed = false

    var body: some View {
        let presentation = NativeLiveMessagePresentationProjector.project(source)
        HStack(alignment: .top, spacing: 0) {
            Spacer(minLength: 48)
            NativeLiveUserMessagePresentationView(presentation: presentation,
                                                 isVoiceTranscriptRevealed: $isVoiceTranscriptRevealed)

        }
    }
}
