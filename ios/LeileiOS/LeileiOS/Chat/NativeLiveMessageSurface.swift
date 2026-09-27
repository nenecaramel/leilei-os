import SwiftUI
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
            } else if let snapshot {
                if snapshot.messages.isEmpty {
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
                    ForEach(messages) { message in
                        NativeLiveMessageRow(
                            message: message,
                            displayTextOverride:
                                editedTextOverride(
                                    for: message,
                                    pendingIsActive: pendingIsActive
                                ),
                            showPendingReplacement:
                                message.id == replacementAssistantID,
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

                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchorID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .id(
                snapshot?.conversationId
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
        guard let pendingOperation else {
            return false
        }

        return snapshot?.syncToken
            == pendingOperation.baselineSyncToken
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
    let message: NativeLiveCurrentPathMessage
    let displayTextOverride: String?
    let showPendingReplacement: Bool
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    var body: some View {
        rowContent
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

                AssistantTypingIndicatorRow()
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

            MindWriteIndicator(items: [])

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
            let visibleBlocks = blocks.filter {
                normalizedText($0.text) != nil
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

    private func normalizedText(_ text: String?) -> String? {
        guard let text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
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

            if let pendingInteraction {
                switch pendingInteraction.kind {
                case "permission":
                    NativeLivePermissionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )

                case "question":
                    NativeLiveQuestionInteractionCard(
                        interaction: pendingInteraction,
                        onResolve: onResolveInteraction
                    )

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

    var body: some View {
        if let text = normalizedText {
            switch block.kind {
            case "text":
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: fillsAvailableWidth,
                    lineSpacing: isUserMessage ? 5 : 6,
                    paragraphSpacing: isUserMessage ? 19 : 22
                )

            case "tool_use", "tool_result", "attachment":
                Text(text)
                    .font(.system(size: 15))
                    .tracking(0.10)
                    .lineSpacing(isUserMessage ? 5 : 6)
                    .foregroundStyle(.secondary)
                    .frame(
                        maxWidth: fillsAvailableWidth ? .infinity : nil,
                        alignment: .leading
                    )

            default:
                EmptyView()
            }
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
    static func string(from iso8601: String) -> String {
        guard let date = parse(iso8601) else {
            return ""
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .autoupdatingCurrent
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
