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
                if snapshot?.olderCursor != nil {
                    await onLoadOlder()
                } else {
                    await onRefresh()
                }
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


private struct NativeLiveRuntimeAssistantRow: View {
    let runtimeSurface: NativeLiveRuntimeSurfaceState?
    let onResolveInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    var body: some View {
        let text = runtimeSurface?.streamingText
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        let activity = runtimeSurface?.activityText
        let pendingInteraction =
            runtimeSurface?.interactions.first {
                $0.isPending
            }

        VStack(alignment: .leading, spacing: 12) {
            if let text,
               !text.isEmpty {
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: true,
                    lineSpacing: 6,
                    paragraphSpacing: 22
                )
            }

            if let activity,
               !activity.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)

                    Text(activity)
                        .font(.system(
                            size: 13.5,
                            weight: .regular
                        ))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                .transition(.opacity)
            }

            if let runtimeSurface {
                let toolUses = runtimeSurface.events.filter {
                    $0.event.type == "tool_use"
                }
                ForEach(toolUses) { toolUse in
                    NativeLiveRuntimeToolCallRow(
                        toolUse: toolUse,
                        events: runtimeSurface.events
                    )
                }
            }

            if let pendingInteraction {
                switch pendingInteraction.kind {
                case "permission":
                    NativeLivePermissionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )
                    .id(pendingInteraction.interactionID)

                case "question":
                    NativeLiveQuestionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )
                    .id(pendingInteraction.interactionID)

                default:
                    EmptyView()
                }
            }

            if (text?.isEmpty ?? true)
                && activity == nil
                && pendingInteraction == nil {
                AssistantTypingIndicatorRow()
            }
        }
        .frame(
            maxWidth: .infinity,
            alignment: .leading
        )
    }
}

private struct NativeLivePermissionInteractionCard: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot
    let onResolve:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(interaction.permissionTitle)
                    .font(.system(
                        size: 16,
                        weight: .medium
                    ))

                if let tool = interaction.permissionToolName {
                    Text(tool)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let detail = interaction.permissionDetail {
                    Text(detail)
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack(spacing: 10) {
                Button("Deny", role: .destructive) {
                    submit(
                        [
                            "decision": .string("deny"),
                            "message":
                                .string("Denied by user in LeileiOS."),
                            "interrupt": .bool(false),
                        ]
                    )
                }
                .buttonStyle(.bordered)
                .disabled(isSubmitting)

                Button("Allow") {
                    submit(
                        [
                            "decision": .string("allow"),
                        ]
                    )
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSubmitting)
            }
        }
        .padding(14)
        .background(
            Color.primary.opacity(0.055),
            in: RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
        )
    }

    private func submit(
        _ response: [String: NativeLiveJSONValue]
    ) {
        guard !isSubmitting else { return }

        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                try await onResolve(
                    interaction,
                    response
                )
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}

private struct NativeLiveQuestionInteractionCard: View {
    let interaction: NativeLiveRuntimeInteractionSnapshot
    let onResolve:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void

    @State private var selectedOptions:
        [String: Set<String>] = [:]
    @State private var customAnswers:
        [String: String] = [:]
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        let questions = interaction.questions

        VStack(alignment: .leading, spacing: 16) {
            ForEach(questions) { question in
                VStack(alignment: .leading, spacing: 10) {
                    if let header = question.header {
                        Text(header)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(question.text)
                        .font(.system(
                            size: 16,
                            weight: .medium
                        ))

                    if !question.options.isEmpty {
                        VStack(spacing: 7) {
                            ForEach(question.options) { option in
                                Button {
                                    toggle(
                                        option.label,
                                        for: question
                                    )
                                } label: {
                                    HStack(
                                        alignment: .top,
                                        spacing: 10
                                    ) {
                                        Image(
                                            systemName:
                                                isSelected(
                                                    option.label,
                                                    for: question
                                                )
                                                ? (
                                                    question.multiSelect
                                                        ? "checkmark.square.fill"
                                                        : "checkmark.circle.fill"
                                                )
                                                : (
                                                    question.multiSelect
                                                        ? "square"
                                                        : "circle"
                                                )
                                        )
                                        .foregroundStyle(
                                            isSelected(
                                                option.label,
                                                for: question
                                            )
                                                ? Color.accentColor
                                                : Color.secondary
                                        )

                                        VStack(
                                            alignment: .leading,
                                            spacing: 2
                                        ) {
                                            Text(option.label)
                                                .foregroundStyle(.primary)

                                            if let description =
                                                option.description {
                                                Text(description)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }

                                        Spacer(minLength: 0)
                                    }
                                    .frame(
                                        maxWidth: .infinity,
                                        alignment: .leading
                                    )
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(isSubmitting)
                            }
                        }
                    }

                    TextField(
                        question.options.isEmpty
                            ? "Answer"
                            : "Other answer",
                        text: customAnswerBinding(
                            for: question.text
                        ),
                        axis: .vertical
                    )
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isSubmitting)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            HStack(spacing: 10) {
                Button("Cancel") {
                    submit(
                        [
                            "decision": .string("cancel"),
                            "message":
                                .string("User dismissed the question."),
                        ]
                    )
                }
                .buttonStyle(.bordered)
                .disabled(isSubmitting)

                Button("Submit") {
                    submitAnswers()
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    isSubmitting
                        || !canSubmit(questions)
                )
            }
        }
        .padding(14)
        .background(
            Color.primary.opacity(0.055),
            in: RoundedRectangle(
                cornerRadius: 14,
                style: .continuous
            )
        )
    }

    private func isSelected(
        _ option: String,
        for question: NativeLiveRuntimeQuestion
    ) -> Bool {
        selectedOptions[question.text]?.contains(option) == true
    }

    private func toggle(
        _ option: String,
        for question: NativeLiveRuntimeQuestion
    ) {
        customAnswers[question.text] = ""

        if question.multiSelect {
            var selected =
                selectedOptions[question.text] ?? []
            if selected.contains(option) {
                selected.remove(option)
            } else {
                selected.insert(option)
            }
            selectedOptions[question.text] = selected
        } else {
            selectedOptions[question.text] = [option]
        }
    }

    private func customAnswerBinding(
        for question: String
    ) -> Binding<String> {
        Binding(
            get: {
                customAnswers[question] ?? ""
            },
            set: { value in
                customAnswers[question] = value
                if !value.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty {
                    selectedOptions[question] = []
                }
            }
        )
    }

    private func answer(
        for question: NativeLiveRuntimeQuestion
    ) -> String? {
        let custom =
            customAnswers[question.text]?
                .trimmingCharacters(
                    in: .whitespacesAndNewlines
                ) ?? ""
        if !custom.isEmpty {
            return custom
        }

        let selected =
            selectedOptions[question.text] ?? []
        let ordered =
            question.options
                .map(\.label)
                .filter {
                    selected.contains($0)
                }

        guard !ordered.isEmpty else {
            return nil
        }
        return ordered.joined(separator: ", ")
    }

    private func canSubmit(
        _ questions: [NativeLiveRuntimeQuestion]
    ) -> Bool {
        !questions.isEmpty
            && questions.allSatisfy {
                answer(for: $0) != nil
            }
    }

    private func submitAnswers() {
        let questions = interaction.questions
        guard canSubmit(questions) else {
            return
        }

        var answers:
            [String: NativeLiveJSONValue] = [:]
        for question in questions {
            guard let answer = answer(
                for: question
            ) else {
                return
            }
            answers[question.text] = .string(answer)
        }

        submit(
            [
                "decision": .string("answer"),
                "answers": .object(answers),
            ]
        )
    }

    private func submit(
        _ response: [String: NativeLiveJSONValue]
    ) {
        guard !isSubmitting else { return }

        isSubmitting = true
        errorMessage = nil

        Task { @MainActor in
            do {
                try await onResolve(
                    interaction,
                    response
                )
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}


private struct AssistantTypingIndicatorRow: View {
    var body: some View {
        TimelineView(
            .animation(minimumInterval: 0.18)
        ) { context in
            let phase = Int(
                context.date.timeIntervalSinceReferenceDate / 0.18
            ) % 3

            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(
                            Color.secondary.opacity(
                                phase == index ? 0.82 : 0.24
                            )
                        )
                        .frame(width: 5, height: 5)
                        .scaleEffect(
                            phase == index ? 1.08 : 0.92
                        )
                }
            }
            .frame(height: 22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}


private struct LightweightContextMenuInteraction: UIViewRepresentable {
    let title: String
    let copyText: String?
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let onCopy: (String) -> Void
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            title: title,
            copyText: copyText,
            isDisabled: isDisabled,
            cornerRadius: cornerRadius,
            onCopy: onCopy,
            action: action
        )
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isOpaque = false

        let interaction = UIContextMenuInteraction(
            delegate: context.coordinator
        )
        view.addInteraction(interaction)
        context.coordinator.hostView = view
        return view
    }

    func updateUIView(
        _ uiView: UIView,
        context: Context
    ) {
        context.coordinator.title = title
        context.coordinator.copyText = copyText
        context.coordinator.isDisabled = isDisabled
        context.coordinator.cornerRadius = cornerRadius
        context.coordinator.onCopy = onCopy
        context.coordinator.action = action
        context.coordinator.hostView = uiView
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        weak var hostView: UIView?

        var title: String
        var copyText: String?
        var isDisabled: Bool
        var cornerRadius: CGFloat
        var onCopy: (String) -> Void
        var action: () -> Void

        init(
            title: String,
            copyText: String?,
            isDisabled: Bool,
            cornerRadius: CGFloat,
            onCopy: @escaping (String) -> Void,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.copyText = copyText
            self.isDisabled = isDisabled
            self.cornerRadius = cornerRadius
            self.onCopy = onCopy
            self.action = action
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint
        ) -> UIContextMenuConfiguration? {
            UIContextMenuConfiguration(
                identifier: nil,
                previewProvider: nil
            ) { [weak self] _ in
                guard let self else {
                    return UIMenu(children: [])
                }

                var children: [UIMenuElement] = []

                if let copyText = self.copyText,
                   !copyText.isEmpty {
                    let copyAction = UIAction(
                        title: "Copy",
                        image: nil
                    ) { [weak self] _ in
                        self?.onCopy(copyText)
                    }
                    children.append(copyAction)
                }

                let attributes: UIMenuElement.Attributes =
                    self.isDisabled ? [.disabled] : []

                let action = UIAction(
                    title: self.title,
                    image: nil,
                    attributes: attributes
                ) { [weak self] _ in
                    self?.action()
                }

                children.append(action)
                return UIMenu(children: children)
            }
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configuration: UIContextMenuConfiguration,
            highlightPreviewForItemWithIdentifier identifier: any NSCopying
        ) -> UITargetedPreview? {
            preview(for: interaction)
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configuration: UIContextMenuConfiguration,
            dismissalPreviewForItemWithIdentifier identifier: any NSCopying
        ) -> UITargetedPreview? {
            preview(for: interaction)
        }

        private func preview(
            for interaction: UIContextMenuInteraction
        ) -> UITargetedPreview? {
            guard let hostView = interaction.view else {
                return nil
            }

            let previewView = hostView.superview ?? hostView
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(
                roundedRect: previewView.bounds,
                cornerRadius: cornerRadius
            )
            parameters.shadowPath = UIBezierPath()

            return UITargetedPreview(
                view: previewView,
                parameters: parameters
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


private struct NativeLiveAttachmentBlockView: View {
    @EnvironmentObject private var appModel: AppModel

    let block: NativeLiveCurrentPathBlock

    @State private var downloadURL: URL?
    @State private var preview: NativeLiveAttachmentPreview?
    @State private var previewDirectoryURL: URL?
    @State private var isPreparingPreview = false

    private var payload: [String: NativeLiveJSONValue] {
        block.payload ?? [:]
    }

    private var attachmentID: String? {
        payload["attachment_id"]?.stringValue
    }

    private var filename: String {
        payload["filename"]?.stringValue ?? "Attachment"
    }

    private var mimeType: String {
        payload["mime_type"]?.stringValue
            ?? "application/octet-stream"
    }

    private var expectedSHA256: String? {
        payload["sha256"]?.stringValue?.lowercased()
    }

    private var expectedSize: Int? {
        guard let value =
                payload["size_bytes"]?.numberValue,
              value >= 0,
              value.rounded() == value,
              value <= Double(Int.max) else {
            return nil
        }
        return Int(value)
    }

    private var isImage: Bool {
        payload["kind"]?.stringValue == "image"
            || mimeType.hasPrefix("image/")
    }

    private var sizeText: String? {
        guard let expectedSize else { return nil }
        return ByteCountFormatter.string(
            fromByteCount: Int64(expectedSize),
            countStyle: .file
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isImage,
               let downloadURL {
                Button {
                    openPreview()
                } label: {
                    AsyncImage(url: downloadURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(maxHeight: 260)
                                .clipShape(
                                    RoundedRectangle(
                                        cornerRadius: 12,
                                        style: .continuous
                                    )
                                )
                        case .failure:
                            attachmentRowContent
                        case .empty:
                            ZStack {
                                RoundedRectangle(
                                    cornerRadius: 12,
                                    style: .continuous
                                )
                                .fill(
                                    Color.primary.opacity(0.045)
                                )
                                ProgressView()
                            }
                            .frame(height: 120)
                        @unknown default:
                            attachmentRowContent
                        }
                    }
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    openPreview()
                } label: {
                    attachmentRowContent
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: attachmentID) {
            guard let attachmentID else { return }
            downloadURL =
                await appModel.nativeLiveAttachmentDownloadURL(
                    attachmentID: attachmentID
                )
        }
        .sheet(item: $preview, onDismiss: cleanupPreview) {
            NativeLiveAttachmentQuickLook(
                fileURL: $0.fileURL
            )
            .presentationBackground(
                Color(.systemBackground)
            )
        }
    }

    private var attachmentRowContent: some View {
        HStack(spacing: 10) {
            Image(
                systemName:
                    isImage
                        ? "photo"
                        : "doc"
            )
            .font(.system(size: 15))
            .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(filename)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(mimeType)
                    if let sizeText {
                        Text("·")
                        Text(sizeText)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            if isPreparingPreview {
                ProgressView()
                    .controlSize(.small)
            } else if downloadURL != nil {
                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 11,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 10)
        .background(
            Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .contentShape(Rectangle())
    }

    private func openPreview() {
        guard !isPreparingPreview else { return }
        if preview != nil { return }
        isPreparingPreview = true

        Task { @MainActor in
            defer { isPreparingPreview = false }
            guard let attachmentID else { return }
            let remoteURL: URL?
            if let downloadURL {
                remoteURL = downloadURL
            } else {
                remoteURL =
                    await appModel.nativeLiveAttachmentDownloadURL(
                        attachmentID: attachmentID
                    )
            }
            guard let remoteURL else { return }

            do {
                let (data, response) =
                    try await URLSession.shared.data(
                        from: remoteURL
                    )
                guard let http =
                        response as? HTTPURLResponse,
                      (200..<300).contains(
                        http.statusCode
                      ) else {
                    return
                }
                if let expectedSize,
                   data.count != expectedSize {
                    return
                }
                if let expectedSHA256 {
                    let digest = SHA256.hash(data: data)
                    let actual = digest.map {
                        String(format: "%02x", $0)
                    }.joined()
                    guard actual == expectedSHA256 else {
                        return
                    }
                }

                let directory =
                    FileManager.default.temporaryDirectory
                    .appendingPathComponent(
                        "LeileiOS-AttachmentPreview",
                        isDirectory: true
                    )
                    .appendingPathComponent(
                        block.id,
                        isDirectory: true
                    )
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
                )
                let localURL =
                    directory.appendingPathComponent(
                        nativeLiveSafePreviewFilename(
                            filename
                        )
                    )
                try data.write(
                    to: localURL,
                    options: [.atomic]
                )
                previewDirectoryURL = directory
                preview = NativeLiveAttachmentPreview(
                    fileURL: localURL
                )
            } catch {
                return
            }
        }
    }

    private func cleanupPreview() {
        if let previewDirectoryURL {
            try? FileManager.default.removeItem(
                at: previewDirectoryURL
            )
        }
        previewDirectoryURL = nil
        preview = nil
    }
}


private struct NativeLiveAttachmentPreview: Identifiable {
    let id = UUID()
    let fileURL: URL
}


private struct NativeLiveAttachmentQuickLook:
    UIViewControllerRepresentable {
    let fileURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(fileURL: fileURL)
    }

    func makeUIViewController(
        context: Context
    ) -> UINavigationController {
        let previewController = QLPreviewController()
        previewController.dataSource = context.coordinator
        return UINavigationController(
            rootViewController: previewController
        )
    }

    func updateUIViewController(
        _ uiViewController: UINavigationController,
        context: Context
    ) {}

    final class Coordinator:
        NSObject,
        QLPreviewControllerDataSource {
        let fileURL: URL

        init(fileURL: URL) {
            self.fileURL = fileURL
        }

        func numberOfPreviewItems(
            in controller: QLPreviewController
        ) -> Int {
            1
        }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            fileURL as NSURL
        }
    }
}


private func nativeLiveSafePreviewFilename(
    _ filename: String
) -> String {
    let cleaned = filename
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "\\", with: "_")
        .trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    return cleaned.isEmpty
        ? "Attachment"
        : String(cleaned.prefix(180))
}


private struct NativeLiveRuntimeToolCallRow: View {
    let toolUse: NativeLiveRuntimeEventSnapshot
    let events: [NativeLiveRuntimeEventSnapshot]

    private var toolUseID: String? {
        toolUse.event.payload?["tool_use_id"]?.stringValue
    }

    private var result: NativeLiveRuntimeEventSnapshot? {
        guard let toolUseID else { return nil }
        return events.last(where: { event in
            event.event.type == "tool_result"
                && event.event.payload?["tool_use_id"]?.stringValue
                    == toolUseID
        })
    }

    var body: some View {
        NativeLiveToolCallCard(
            toolName:
                toolUse.event.payload?["tool_name"]?.stringValue
                ?? "Tool",
            detail: nativeLiveJSONDetail(
                toolUse.event.payload?["input"]
            ),
            state:
                result == nil
                    ? .running
                    : (
                        result?.event.payload?["is_error"]?.boolValue
                            == true
                        ? .failed
                        : .completed
                    )
        )
    }
}


private enum NativeLiveToolCallState {
    case running
    case completed
    case failed
}


private struct NativeLiveToolCallCard: View {
    let toolName: String
    let detail: String?
    let state: NativeLiveToolCallState

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                switch state {
                case .running:
                    ProgressView()
                        .controlSize(.small)
                case .completed:
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                case .failed:
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }

                Text(nativeLiveToolDisplayName(toolName))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 8)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 11)
        .padding(.vertical, 9)
        .background(
            Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: nativeLiveToolDisplayName(toolName),
                status: stateLabel,
                sectionTitle: "Input",
                detail: detail
            )
        }
    }

    private var stateLabel: String {
        switch state {
        case .running:
            return "Running"
        case .completed:
            return "Done"
        case .failed:
            return "Failed"
        }
    }
}


private struct NativeLiveToolResultCard: View {
    let isError: Bool
    let detail: String?

    @State private var isShowingDetails = false

    var body: some View {
        Button {
            isShowingDetails = true
        } label: {
            HStack(spacing: 8) {
                Image(
                    systemName:
                        isError
                        ? "exclamationmark.circle"
                        : "checkmark.circle"
                )
                .font(.system(size: 13))
                .foregroundStyle(.secondary)

                Text(isError ? "Tool failed" : "Tool result")
                    .font(.system(
                        size: 13.5,
                        weight: .medium
                    ))
                    .foregroundStyle(.secondary)

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 10.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.leading, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: $isShowingDetails) {
            NativeLiveToolDetailSheet(
                title: isError ? "Tool failed" : "Tool result",
                status: isError ? "Failed" : "Done",
                sectionTitle: "Output",
                detail: detail
            )
        }
    }
}


private struct NativeLiveToolDetailSheet: View {
    @Environment(\.dismiss) private var dismiss

    let title: String
    let status: String
    let sectionTitle: String
    let detail: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text(status)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        Spacer()
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text(sectionTitle)
                            .font(.headline)

                        if let detail,
                           !detail.isEmpty {
                            Text(detail)
                                .font(.system(
                                    size: 13,
                                    design: .monospaced
                                ))
                                .foregroundStyle(.primary)
                                .textSelection(.enabled)
                                .fixedSize(
                                    horizontal: false,
                                    vertical: true
                                )
                                .frame(
                                    maxWidth: .infinity,
                                    alignment: .leading
                                )
                        } else {
                            Text("No details")
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 36)
            }
            .background(Color(.systemBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([
            .medium,
            .large
        ])
        .presentationDragIndicator(.visible)
        .presentationBackground(
            Color(.systemBackground)
        )
    }
}


private func nativeLiveToolDisplayName(
    _ raw: String
) -> String {
    let prefix = "mcp__leileios__"
    guard raw.hasPrefix(prefix) else {
        return raw
    }
    return "LeileiOS · " + String(raw.dropFirst(prefix.count))
}


private func nativeLiveJSONDetail(
    _ value: NativeLiveJSONValue?
) -> String? {
    guard let value else { return nil }
    let rendered = nativeLiveJSONDescription(value)
    let normalized = rendered.trimmingCharacters(
        in: .whitespacesAndNewlines
    )
    return normalized.isEmpty ? nil : normalized
}


private func nativeLiveJSONDescription(
    _ value: NativeLiveJSONValue
) -> String {
    switch value {
    case .string(let string):
        return string
    case .number(let number):
        return String(number)
    case .bool(let bool):
        return bool ? "true" : "false"
    case .null:
        return "null"
    case .array(let values):
        return "["
            + values.map(nativeLiveJSONDescription)
                .joined(separator: ", ")
            + "]"
    case .object(let object):
        return "{"
            + object.keys.sorted().map { key in
                let value = object[key] ?? .null
                return key
                    + ": "
                    + nativeLiveJSONDescription(value)
            }
            .joined(separator: ", ")
            + "}"
    }
}


private struct ChatMarkdownView: View {
    let text: String
    let fillsAvailableWidth: Bool
    let lineSpacing: CGFloat
    let paragraphSpacing: CGFloat

    private let baseFontSize: CGFloat = 17

    var body: some View {
        VStack(alignment: .leading, spacing: paragraphSpacing) {
            ForEach(
                Array(ChatMarkdownParser.blocks(from: text).enumerated()),
                id: \.offset
            ) { _, block in
                blockView(block)
            }
        }
        .frame(
            maxWidth: fillsAvailableWidth ? .infinity : nil,
            alignment: .leading
        )
    }

    @ViewBuilder
    private func blockView(
        _ block: ChatMarkdownBlock
    ) -> some View {
        switch block {
        case .paragraph(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)

        case .heading(let level, let text):
            inlineText(text)
                .font(.system(
                    size: headingSize(level),
                    weight: level <= 2 ? .semibold : .medium
                ))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .padding(.top, level == 1 ? 2 : 0)

        case .quote(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.primary.opacity(0.20))
                        .frame(width: 2)
                }

        case .unorderedItem(let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .orderedItem(let number, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(number).")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .foregroundStyle(.secondary)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .codeBlock(let code):
            Text(code)
                .font(.system(size: 14, design: .monospaced))
                .tracking(0.08)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.primary.opacity(0.055),
                    in: RoundedRectangle(
                        cornerRadius: 10,
                        style: .continuous
                    )
                )

        case .divider:
            Divider()
                .opacity(0.55)
        }
    }

    private func inlineText(_ source: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: source,
            options: .init(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return Text(attributed)
        }

        return Text(source)
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1:
            return 20.5
        case 2:
            return 18.5
        case 3:
            return 17.5
        default:
            return 17
        }
    }
}

private enum ChatMarkdownBlock {
    case paragraph(String)
    case heading(level: Int, text: String)
    case quote(String)
    case unorderedItem(String)
    case orderedItem(number: Int, text: String)
    case codeBlock(String)
    case divider
}

private enum ChatMarkdownParser {
    static func blocks(
        from source: String
    ) -> [ChatMarkdownBlock] {
        let lines = source.components(separatedBy: .newlines)
        var result: [ChatMarkdownBlock] = []
        var paragraph: [String] = []
        var codeLines: [String] = []
        var isInCodeBlock = false

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            result.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph.removeAll(keepingCapacity: true)
        }

        func flushCodeBlock() {
            result.append(.codeBlock(codeLines.joined(separator: "\n")))
            codeLines.removeAll(keepingCapacity: true)
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flushParagraph()

                if isInCodeBlock {
                    flushCodeBlock()
                    isInCodeBlock = false
                } else {
                    isInCodeBlock = true
                }
                continue
            }

            if isInCodeBlock {
                codeLines.append(line)
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if trimmed == "---"
                || trimmed == "***"
                || trimmed == "___" {
                flushParagraph()
                result.append(.divider)
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                result.append(
                    .heading(
                        level: heading.level,
                        text: heading.text
                    )
                )
                continue
            }

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                result.append(
                    .quote(String(trimmed.dropFirst(2)))
                )
                continue
            }

            if let item = unorderedItem(from: trimmed) {
                flushParagraph()
                result.append(.unorderedItem(item))
                continue
            }

            if let item = orderedItem(from: trimmed) {
                flushParagraph()
                result.append(
                    .orderedItem(
                        number: item.number,
                        text: item.text
                    )
                )
                continue
            }

            paragraph.append(line)
        }

        flushParagraph()

        if isInCodeBlock || !codeLines.isEmpty {
            flushCodeBlock()
        }

        return result
    }

    private static func heading(
        from line: String
    ) -> (level: Int, text: String)? {
        let level = line.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else {
            return nil
        }

        let index = line.index(
            line.startIndex,
            offsetBy: level
        )
        guard index < line.endIndex,
              line[index] == " " else {
            return nil
        }

        let text = String(line[line.index(after: index)...])
        return (level, text)
    }

    private static func unorderedItem(
        from line: String
    ) -> String? {
        for prefix in ["- ", "* ", "+ "] {
            if line.hasPrefix(prefix) {
                return String(line.dropFirst(prefix.count))
            }
        }

        return nil
    }

    private static func orderedItem(
        from line: String
    ) -> (number: Int, text: String)? {
        guard let dot = line.firstIndex(of: ".") else {
            return nil
        }

        let numberText = line[..<dot]
        guard let number = Int(numberText) else {
            return nil
        }

        let afterDot = line.index(after: dot)
        guard afterDot < line.endIndex,
              line[afterDot] == " " else {
            return nil
        }

        let textStart = line.index(after: afterDot)
        return (
            number,
            String(line[textStart...])
        )
    }
}


private enum MessageTimestampFormatter {
    static func string(
        from iso8601: String,
        timeZoneIdentifier: String? = nil
    ) -> String {
        guard let date = parse(iso8601) else {
            return ""
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone =
            timeZoneIdentifier.flatMap(TimeZone.init(identifier:))
            ?? .autoupdatingCurrent
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}
