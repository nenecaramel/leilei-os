import SwiftUI
import QuickLook
import CryptoKit
import UIKit

struct NativeLivePendingOperation: Equatable {
    enum Kind: Equatable {
        case send(text: String)
        case retry(targetUserMessageID: String)
        case edit(targetUserMessageID: String, text: String)
    }

    let id: UUID
    let kind: Kind
    let baselineSyncToken: String?

    init(
        kind: Kind,
        baselineSyncToken: String?
    ) {
        self.id = UUID()
        self.kind = kind
        self.baselineSyncToken = baselineSyncToken
    }

    private init(
        id: UUID,
        kind: Kind,
        baselineSyncToken: String?
    ) {
        self.id = id
        self.kind = kind
        self.baselineSyncToken = baselineSyncToken
    }

    func rebased(
        to syncToken: String?
    ) -> NativeLivePendingOperation {
        NativeLivePendingOperation(
            id: id,
            kind: kind,
            baselineSyncToken: syncToken
        )
    }

    var targetUserMessageID: String? {
        switch kind {
        case .send:
            return nil
        case .retry(let targetUserMessageID):
            return targetUserMessageID
        case .edit(let targetUserMessageID, _):
            return targetUserMessageID
        }
    }

    var editedText: String? {
        guard case .edit(_, let text) = kind else {
            return nil
        }
        return text
    }

    var sendText: String? {
        guard case .send(let text) = kind else {
            return nil
        }
        return text
    }

    var isSend: Bool {
        if case .send = kind {
            return true
        }
        return false
    }
}

struct NativeLiveMessageSurface: View {
    let snapshot: NativeLiveCurrentPathSnapshot?
    let historySnapshot: NativeLiveConversationHistorySnapshot?
    let syncState: AppModel.ChatSyncState
    let isAuthenticated: Bool
    let hasActiveConversation: Bool
    let isTurnInFlight: Bool
    let pendingOperation: NativeLivePendingOperation?
    let runtimeSurface: NativeLiveRuntimeSurfaceState?
    let onResolveRuntimeInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void
    let onRefresh: () async -> Void
    let onLoadOlder: () async -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    private let bottomAnchorID = "native-live-chat-bottom"
    @State private var isAwayFromBottom = false
    @State private var copiedMessageID: String?
    @State private var copyFeedbackToken = UUID()
    @State private var isLoadingOlderMessages = false

    var body: some View {
        Group {
            if !isAuthenticated {
                AppStateSurface(title: "Sign in")
            } else if pendingOperation != nil {
                messageList(snapshot)
            } else if !hasActiveConversation {
                AppStateSurface(title: "Nothing here")
            } else if snapshot != nil || historySnapshot != nil {
                if (snapshot?.messages.isEmpty ?? true)
                    && (historySnapshot?.messages.isEmpty ?? true) {
                    Color.clear
                } else {
                    messageList(snapshot)
                }
            } else {
                switch syncState {
                case .idle, .loading:
                    Color.clear

                case .ready:
                    AppStateSurface(title: "Nothing here")

                case .unavailable:
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await onRefresh()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private func messageList(
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> some View {
        let messages = snapshot?.messages ?? []
        let pendingIsActive = pendingPresentationIsActive(snapshot)
        let replacementAssistantID =
            pendingIsActive
                ? pendingAssistantMessageID(
                    in: messages
                )
                : nil

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 21) {
                    if let historySnapshot {
                        ForEach(historySnapshot.messages) { message in
                            NativeLiveHistorySnapshotRow(
                                message: message,
                                timeZone: historySnapshot.timeZone
                            )
                            .id(
                                "history-"
                                    + String(message.ordinal)
                            )
                        }

                        NativeLiveHistoryForkDivider()
                            .id("native-live-history-fork-divider")
                    }

                    if snapshot?.olderCursor != nil {
                        Button {
                            guard !isLoadingOlderMessages,
                                  !isTurnInFlight else {
                                return
                            }

                            isLoadingOlderMessages = true
                            Task {
                                await onLoadOlder()
                                await MainActor.run {
                                    isLoadingOlderMessages = false
                                }
                            }
                        } label: {
                            HStack(spacing: 8) {
                                if isLoadingOlderMessages {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "chevron.up")
                                        .font(.system(size: 12, weight: .semibold))
                                }

                                Text(
                                    isLoadingOlderMessages
                                        ? "正在加载…"
                                        : "还有更早消息"
                                )
                                .font(.footnote.weight(.medium))
                            }
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                        .disabled(
                            isLoadingOlderMessages
                                || isTurnInFlight
                        )
                        .id("native-live-load-older")
                    }

                    ForEach(messages) { message in
                        NativeLiveMessageRow(
                            message: message,
                            isCurrentHead:
                                message.id
                                    == snapshot?.currentHeadMessageId,
                            displayTextOverride:
                                editedTextOverride(
                                    for: message,
                                    pendingIsActive: pendingIsActive
                                ),
                            showPendingReplacement:
                                message.id == replacementAssistantID,
                            replacementRuntimeSurface:
                                message.id == replacementAssistantID
                                    ? runtimeSurface
                                    : nil,
                            onResolveReplacementInteraction:
                                onResolveRuntimeInteraction,
                            isTurnInFlight: isTurnInFlight,
                            isCopied: copiedMessageID == message.id,
                            onCopyMessage: { text in
                                copyMessage(
                                    text,
                                    messageID: message.id
                                )
                            },
                            onRetryMessage: onRetryMessage,
                            onEditMessage: onEditMessage
                        )
                        .id(message.id)

                        if pendingIsActive,
                           replacementAssistantID == nil,
                           let targetUserMessageID =
                                pendingOperation?.targetUserMessageID,
                           message.id == targetUserMessageID {
                            NativeLiveRuntimeAssistantRow(
                                runtimeSurface: runtimeSurface,
                                onResolveInteraction:
                                    onResolveRuntimeInteraction
                            )
                            .id(
                                "pending-assistant-"
                                    + (pendingOperation?.id.uuidString ?? "")
                            )
                        }
                    }

                    if pendingIsActive,
                       let pendingOperation,
                       let sendText = pendingOperation.sendText {
                        NativeLiveOptimisticUserRow(
                            text: sendText
                        )
                        .id(
                            "pending-user-"
                                + pendingOperation.id.uuidString
                        )

                        NativeLiveRuntimeAssistantRow(
                            runtimeSurface: runtimeSurface,
                            onResolveInteraction:
                                onResolveRuntimeInteraction
                        )
                        .id(
                            "pending-assistant-"
                                + pendingOperation.id.uuidString
                        )
                    }

                    if pendingOperation == nil,
                       runtimeSurface != nil {
                        NativeLiveRuntimeAssistantRow(
                            runtimeSurface: runtimeSurface,
                            onResolveInteraction:
                                onResolveRuntimeInteraction
                        )
                        .id(
                            "recovered-runtime-assistant-"
                                + (runtimeSurface?.prepareID ?? "")
                        )
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchorID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .scrollClipDisabled()
            .id(
                snapshot?.conversationId
                    ?? historySnapshot?.conversationId
                    ?? "native-live-empty"
            )
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .refreshable {
                guard !isTurnInFlight else { return }
                await onRefresh()
            }
            .onChange(of: snapshot?.conversationId) { _, _ in
                isAwayFromBottom = false
            }
            .onChange(of: pendingOperation) { _, operation in
                guard let operation,
                      operation.isSend else {
                    return
                }
                scrollToBottom(proxy)
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.visibleRect.maxY
                    < geometry.contentSize.height - 12
            } action: { _, awayFromBottom in
                guard awayFromBottom != isAwayFromBottom else {
                    return
                }

                withAnimation(.easeInOut(duration: 0.16)) {
                    isAwayFromBottom = awayFromBottom
                }
            }
            .onChange(of: snapshot?.syncToken) { _, _ in
                guard pendingOperation?.isSend == true
                        || !isAwayFromBottom else {
                    return
                }
                scrollToBottom(proxy)
            }
            .onChange(of: runtimeSurface?.events.count) { _, _ in
                guard pendingOperation != nil else {
                    return
                }
                scrollToBottom(proxy)
            }
            .overlay(alignment: .top) {
                if copiedMessageID != nil {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark")
                            .font(.system(
                                size: 12,
                                weight: .semibold
                            ))

                        Text("Message copied")
                            .font(.system(
                                size: 14,
                                weight: .regular
                            ))

                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 14)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: 40
                    )
                    .glassEffect(
                        .regular,
                        in: RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                    )
                    .overlay {
                        RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                        .stroke(
                            Color.primary.opacity(0.08),
                            lineWidth: 0.6
                        )
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 10)
                    .transition(
                        .move(edge: .top)
                            .combined(with: .opacity)
                    )
                }
            }
            .overlay(alignment: .bottom) {
                if isAwayFromBottom {
                    Button {
                        isAwayFromBottom = false
                        withAnimation(.snappy) {
                            proxy.scrollTo(
                                bottomAnchorID,
                                anchor: .bottom
                            )
                        }
                    } label: {
                        Image(systemName: "arrow.down")
                            .font(.system(
                                size: 16,
                                weight: .light
                            ))
                            .foregroundStyle(
                                Color.primary.opacity(0.78)
                            )
                            .frame(width: 38, height: 38)
                            .glassEffect(
                                .regular,
                                in: Circle()
                            )
                            .overlay {
                                Circle()
                                    .stroke(
                                        Color.primary.opacity(0.08),
                                        lineWidth: 0.6
                                    )
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Scroll to latest")
                    .offset(y: 22)
                    .transition(
                        .scale(scale: 0.9)
                            .combined(with: .opacity)
                    )
                }
            }
        }
    }

    private func pendingPresentationIsActive(
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> Bool {
        pendingOperation != nil
    }

    private func pendingAssistantMessageID(
        in messages: [NativeLiveCurrentPathMessage]
    ) -> String? {
        guard let targetUserMessageID =
                pendingOperation?.targetUserMessageID else {
            return nil
        }

        return messages.first(where: {
            $0.role == "assistant"
                && $0.parentMessageId == targetUserMessageID
        })?.id
    }

    private func editedTextOverride(
        for message: NativeLiveCurrentPathMessage,
        pendingIsActive: Bool
    ) -> String? {
        guard pendingIsActive,
              let pendingOperation,
              case .edit(
                  let targetUserMessageID,
                  let text
              ) = pendingOperation.kind,
              message.id == targetUserMessageID else {
            return nil
        }

        return text
    }

    private func copyMessage(
        _ text: String,
        messageID: String
    ) {
        UIPasteboard.general.string = text

        let token = UUID()
        copyFeedbackToken = token

        withAnimation(.easeInOut(duration: 0.16)) {
            copiedMessageID = messageID
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard copyFeedbackToken == token else { return }

            withAnimation(.easeInOut(duration: 0.16)) {
                copiedMessageID = nil
            }
        }
    }

    private func scrollToBottom(
        _ proxy: ScrollViewProxy
    ) {
        isAwayFromBottom = false
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }
}


private struct NativeLiveMessageRow: View {
    @EnvironmentObject private var appModel: AppModel

    let message: NativeLiveCurrentPathMessage
    let isCurrentHead: Bool
    let displayTextOverride: String?
    let showPendingReplacement: Bool
    let replacementRuntimeSurface:
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
                    messageContent
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

    private var assistantContent: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(MessageTimestampFormatter.string(
                from: message.completedAt ?? message.createdAt
            ))
                .font(.system(size: 13.5))
                .tracking(0.12)
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)

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
                if block.kind == "tool_use"
                    || block.kind == "tool_result"
                    || block.kind == "attachment" {
                    return true
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


private struct NativeLiveHistorySnapshotRow: View {
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


private struct NativeLiveHistoryForkDivider: View {
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


private struct NativeLiveOptimisticUserRow: View {
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


private struct NativeLiveBlockView: View {
    let block: NativeLiveCurrentPathBlock
    let fillsAvailableWidth: Bool
    let isUserMessage: Bool

    @ViewBuilder
    var body: some View {
        switch block.kind {
        case "text":
            if let text = normalizedText {
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: fillsAvailableWidth,
                    lineSpacing: isUserMessage ? 5 : 6,
                    paragraphSpacing: isUserMessage ? 19 : 22
                )
            }

        case "tool_use":
            NativeLiveToolCallCard(
                toolName:
                    block.payload?["tool_name"]?.stringValue
                    ?? "Tool",
                detail: nativeLiveJSONDetail(
                    block.payload?["input"]
                ),
                state: .completed
            )

        case "tool_result":
            NativeLiveToolResultCard(
                isError:
                    block.payload?["is_error"]?.boolValue
                    == true,
                detail: nativeLiveJSONDetail(
                    block.payload?["output"]
                )
            )

        case "attachment":
            NativeLiveAttachmentBlockView(block: block)

        default:
            EmptyView()
        }
    }

    private var normalizedText: String? {
        guard let text = block.text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }
}
