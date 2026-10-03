import SwiftUI
import Foundation

struct NativeLiveMessageRow: View {
    @EnvironmentObject private var appModel: AppModel

    let message: NativeLiveCurrentPathMessage
    let isCurrentHead: Bool
    let displayTextOverride: String?
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
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            Color.chatSoftFill,
                            in: RoundedRectangle(
                                cornerRadius: 18,
                                style: .continuous
                            )
                        )
                        .overlay {
                            LightweightContextMenuInteraction(
                                title: "Edit",
                                copyText: copyText,
                                isDisabled: isTurnInFlight,
                                cornerRadius: 18,
                                onCopy: onCopyMessage
                            ) {
                                onEditMessage(message)
                            }
                        }

                    if isVoiceInputMessage,
                       !isVoiceTranscriptRevealed,
                       voiceTranscriptText != nil {
                        Button("转文字") {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                isVoiceTranscriptRevealed = true
                            }
                        }
                        .font(.system(size: 12.5, weight: .regular))
                        .foregroundStyle(.secondary)
                        .buttonStyle(.plain)
                    }

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

    @ViewBuilder
    private var userMessagePresentation: some View {
        if isVoiceInputMessage,
           !isVoiceTranscriptRevealed {
            NativeLiveVoiceMessageBubbleVisual()
        } else {
            messageContent
        }
    }

    private var isVoiceInputMessage: Bool {
        guard displayTextOverride == nil else {
            return false
        }

        return message.blocks.contains { block in
            block.payload?["input_mode"]?.stringValue
                == "voice"
        }
    }

    private var voiceTranscriptText: String? {
        copyText
    }

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

    @ViewBuilder
    private var messageContent: some View {
        if let override = normalizedText(displayTextOverride) {
            ChatMarkdownView(
                text: override,
                fillsAvailableWidth: message.role != "user",
                lineSpacing: message.role == "user" ? 5 : 6,
                paragraphSpacing: message.role == "user" ? 19 : 22
            )
        } else {
            let blocks = message.blocks.sorted {
                $0.ordinal < $1.ordinal
            }
            let visibleBlocks = blocks.filter { block in
                if block.kind == "attachment" {
                    return true
                }
                if block.kind == "tool_use"
                    || block.kind == "tool_result" {
                    return message.role == "user"
                }
                return normalizedText(block.text) != nil
            }

            if visibleBlocks.isEmpty {
                if message.status == "pending"
                    || message.status == "streaming" {
                    AssistantTypingIndicatorRow()
                }
            } else {
                VStack(
                    alignment: .leading,
                    spacing: message.role == "user" ? 19 : 22
                ) {
                    ForEach(visibleBlocks) { block in
                        NativeLiveBlockView(
                            block: block,
                            fillsAvailableWidth: message.role != "user",
                            isUserMessage: message.role == "user"
                        )
                    }
                }
            }
        }
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

    private var copyText: String? {
        if let override = normalizedText(displayTextOverride) {
            return override
        }

        let text = message.blocks
            .sorted { $0.ordinal < $1.ordinal }
            .compactMap { normalizedText($0.text) }
            .joined(separator: "\n\n")

        return text.isEmpty ? nil : text
    }

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

    private func normalizedText(_ text: String?) -> String? {
        guard let text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }
}


private struct NativeLiveVoiceMessageBubbleVisual: View {
    private let barHeights: [CGFloat] = [
        8,
        14,
        20,
        11,
        17,
        9,
        15,
        21,
        12,
        18,
        10,
        16,
    ]

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.primary)

            HStack(alignment: .center, spacing: 2.5) {
                ForEach(
                    Array(barHeights.enumerated()),
                    id: \.offset
                ) { _, height in
                    Capsule()
                        .fill(Color.primary.opacity(0.76))
                        .frame(width: 2.2, height: height)
                }
            }
        }
        .frame(minWidth: 128, minHeight: 24, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Voice message")
    }
}


struct NativeLiveHistorySnapshotRow: View {
    let message: NativeLiveConversationHistoryMessage
    let timeZone: String

    var body: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                Spacer(minLength: 48)

                ChatMarkdownView(
                    text: message.content,
                    fillsAvailableWidth: false,
                    lineSpacing: 5,
                    paragraphSpacing: 19
                )
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

                ChatMarkdownView(
                    text: message.content,
                    fillsAvailableWidth: true,
                    lineSpacing: 6,
                    paragraphSpacing: 22
                )
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
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Spacer(minLength: 48)

            ChatMarkdownView(
                text: text,
                fillsAvailableWidth: false,
                lineSpacing: 5,
                paragraphSpacing: 19
            )
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
    }
}
