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
        let runtimeSurface =
            matchingRuntimeSurface(for: snapshot)
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
                            activityRuntimeSurface:
                                pendingOperation == nil
                                    && runtimeSurface?
                                        .foregroundTurnCompleted == true
                                    && message.role == "assistant"
                                    && message.id
                                        == snapshot?.currentHeadMessageId
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
                       let runtimeSurface,
                       !runtimeSurface.foregroundTurnCompleted
                        || !hasCanonicalAssistantHead {
                        NativeLiveRuntimeAssistantRow(
                            runtimeSurface: runtimeSurface,
                            onResolveInteraction:
                                onResolveRuntimeInteraction
                        )
                        .id(
                            "recovered-runtime-assistant-"
                                + runtimeSurface.prepareID
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

    private func matchingRuntimeSurface(
        for snapshot: NativeLiveCurrentPathSnapshot?
    ) -> NativeLiveRuntimeSurfaceState? {
        guard let runtimeSurface,
              let snapshot,
              UUID(uuidString: snapshot.conversationId)
                == runtimeSurface.conversationID else {
            return nil
        }
        return runtimeSurface
    }

    private var hasCanonicalAssistantHead: Bool {
        guard let snapshot,
              let headID = snapshot.currentHeadMessageId else {
            return false
        }
        return snapshot.messages.contains {
            $0.id == headID && $0.role == "assistant"
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
