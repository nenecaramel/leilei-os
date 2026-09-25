import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.scenePhase) private var scenePhase

    let isDraftConversation: Bool
    let draftConversationID: UUID
    let onDraftCommitted: () -> Void

    @State private var messageText = ""
    @State private var model: NativeLiveClaudeModel = .opus55
    @State private var thinking: NativeLiveThinkingMode = .adaptive
    @State private var effort: NativeLiveEffortLevel = .high
    @State private var editDraft: NativeLiveEditDraft?
    @State private var isDraftCommitInFlight = false
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            if isDraftConversation {
                Color.clear
            } else {
                NativeLiveMessageSurface(
                    snapshot: appModel.nativeLiveCurrentPath,
                    syncState: appModel.chatSyncState,
                    isAuthenticated: appModel.isAuthenticated,
                    hasActiveConversation:
                        appModel.activeNativeLiveConversationID != nil,
                    isTurnInFlight:
                        appModel.chatSendState == .sending,
                    onRefresh: {
                        await appModel.refreshNativeLiveCurrentPath(force: true)
                    },
                    onRetryMessage: { targetUserMessageID in
                        retryMessage(targetUserMessageID)
                    },
                    onEditMessage: { message in
                        beginEditing(message)
                    }
                )
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            isComposerFocused = false
        }
        .task(id: appModel.activeNativeLiveConversationID) {
            guard !isDraftConversation else { return }
            await appModel.refreshNativeLiveCurrentPath()
        }
        .task(id: appModel.isAuthenticated) {
            guard appModel.isAuthenticated else { return }
            await appModel.refreshNativeLiveConversations()
            guard !isDraftConversation else { return }
            await appModel.refreshNativeLiveCurrentPath()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await appModel.refreshNativeLiveConversations()
                guard !isDraftConversation else { return }
                await appModel.refreshNativeLiveCurrentPath()
            }
        }
        .onChange(of: draftConversationID) { _, _ in
            messageText = ""
            editDraft = nil
            isComposerFocused = false
        }
        .onChange(of: isDraftConversation) { wasDraft, isDraft in
            if wasDraft && !isDraft && !isDraftCommitInFlight {
                messageText = ""
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatComposer(
                text: $messageText,
                model: $model,
                thinking: $thinking,
                effort: $effort,
                isFocused: $isComposerFocused,
                isSending:
                    appModel.chatSendState == .sending
                        || isDraftCommitInFlight
            ) {
                sendMessage()
            }
            .padding(.horizontal, 12)
            .padding(.top, 18)
            .padding(.bottom, 10)
            .background {
                LinearGradient(
                    colors: [
                        Color(.systemBackground).opacity(0),
                        Color(.systemBackground)
                    ],
                    startPoint: .top,
                    endPoint: .center
                )
                .ignoresSafeArea()
            }
            .offset(y: 10)
        }
        .overlay {
            if isConversationLoading {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
                    .ignoresSafeArea()
            }
        }
        .sheet(item: $editDraft) { draft in
            NativeLiveEditSheet(
                originalText: draft.text
            ) { replacement in
                try await appModel.editNativeLiveMessage(
                    targetUserMessageID: draft.targetUserMessageID,
                    text: replacement,
                    execution: executionSelection
                )
            }
        }
    }

    private var isConversationLoading: Bool {
        guard !isDraftConversation,
              appModel.isAuthenticated,
              appModel.activeNativeLiveConversationID != nil,
              appModel.nativeLiveCurrentPath == nil else {
            return false
        }

        return appModel.chatSyncState == .idle
            || appModel.chatSyncState == .loading
    }

    private func retryMessage(
        _ targetUserMessageID: String
    ) {
        guard appModel.chatSendState != .sending else { return }

        Task { @MainActor in
            try? await appModel.retryNativeLiveMessage(
                targetUserMessageID: targetUserMessageID,
                execution: executionSelection
            )
        }
    }

    private func beginEditing(
        _ message: NativeLiveCurrentPathMessage
    ) {
        guard message.role == "user",
              appModel.chatSendState != .sending else {
            return
        }

        let text = message.displayText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !text.isEmpty else { return }

        editDraft = NativeLiveEditDraft(
            targetUserMessageID: message.id,
            text: text
        )
    }

    private var executionSelection: NativeLiveExecutionSelection {
        NativeLiveExecutionSelection(
            model: model,
            thinking: thinking,
            effort: effort
        )
    }

    private func sendMessage() {
        let pendingText = messageText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !pendingText.isEmpty,
              !isDraftCommitInFlight,
              appModel.chatSendState != .sending else {
            return
        }

        let shouldCreateConversation = isDraftConversation

        messageText = ""
        isComposerFocused = false

        Task { @MainActor in
            do {
                if shouldCreateConversation {
                    isDraftCommitInFlight = true
                    _ = try await appModel.createNativeLiveConversation(
                        title: "New Conversation"
                    )
                    onDraftCommitted()
                }

                try await appModel.sendNativeLiveMessage(
                    pendingText,
                    execution: executionSelection
                )
            } catch {
                if messageText.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty {
                    messageText = pendingText
                }
            }

            isDraftCommitInFlight = false
        }
    }
}


private struct NativeLiveEditDraft: Identifiable {
    let id = UUID()
    let targetUserMessageID: String
    let text: String
}

private struct NativeLiveEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var text: String
    @State private var isSaving = false
    @State private var failed = false

    let onSave: (String) async throws -> Void

    init(
        originalText: String,
        onSave: @escaping (String) async throws -> Void
    ) {
        _text = State(initialValue: originalText)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextEditor(text: $text)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(10)
                    .background(
                        Color.primary.opacity(0.05),
                        in: RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                    )

                if failed {
                    Text("Failed")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .navigationTitle("Edit message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        save()
                    }
                    .disabled(
                        isSaving
                            || normalizedText.isEmpty
                            || normalizedText.count > 4_000
                    )
                }
            }
        }
    }

    private var normalizedText: String {
        text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    }

    private func save() {
        let replacement = normalizedText
        guard !replacement.isEmpty,
              replacement.count <= 4_000,
              !isSaving else {
            return
        }

        isSaving = true
        failed = false

        Task { @MainActor in
            do {
                try await onSave(replacement)
                dismiss()
            } catch {
                failed = true
                isSaving = false
            }
        }
    }
}
