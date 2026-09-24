import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var messageText = ""
    @State private var model = "Opus 5"
    @State private var effort = "High"
    @State private var editDraft: NativeLiveEditDraft?
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

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
        .contentShape(Rectangle())
        .onTapGesture {
            isComposerFocused = false
        }
        .task(id: appModel.activeNativeLiveConversationID) {
            await appModel.refreshNativeLiveCurrentPath()
        }
        .task(id: appModel.isAuthenticated) {
            guard appModel.isAuthenticated else { return }
            await appModel.refreshNativeLiveConversations()
            await appModel.refreshNativeLiveCurrentPath()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await appModel.refreshNativeLiveConversations()
                await appModel.refreshNativeLiveCurrentPath()
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatComposer(
                text: $messageText,
                model: $model,
                effort: $effort,
                isFocused: $isComposerFocused,
                isSending: appModel.chatSendState == .sending
            ) {
                sendMessage()
            }
            .padding(.horizontal, 14)
            .padding(.top, 18)
            .padding(.bottom, 8)
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
        .sheet(item: $editDraft) { draft in
            NativeLiveEditSheet(
                originalText: draft.text
            ) { replacement in
                try await appModel.editNativeLiveMessage(
                    targetUserMessageID: draft.targetUserMessageID,
                    text: replacement
                )
            }
        }
    }

    private func retryMessage(
        _ targetUserMessageID: String
    ) {
        guard appModel.chatSendState != .sending else { return }

        Task { @MainActor in
            try? await appModel.retryNativeLiveMessage(
                targetUserMessageID: targetUserMessageID
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

    private func sendMessage() {
        let pendingText = messageText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !pendingText.isEmpty else { return }

        messageText = ""
        isComposerFocused = false

        Task {
            do {
                try await appModel.sendNativeLiveMessage(pendingText)
            } catch {
                if messageText.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty {
                    messageText = pendingText
                }
            }
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
