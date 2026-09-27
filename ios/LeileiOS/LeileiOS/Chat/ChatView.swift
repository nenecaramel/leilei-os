import SwiftUI
import UIKit

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
    @State private var pendingOperation: NativeLivePendingOperation?
    @State private var isDraftCommitInFlight = false
    @State private var isSystemKeyboardVisible = false
    @State private var showingProjectFilePicker = false
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            if isDraftConversation && pendingOperation == nil {
                Color.clear
            } else {
                NativeLiveMessageSurface(
                    snapshot:
                        isDraftConversation
                            ? nil
                            : appModel.nativeLiveCurrentPath,
                    syncState: appModel.chatSyncState,
                    isAuthenticated: appModel.isAuthenticated,
                    hasActiveConversation:
                        !isDraftConversation
                            && appModel.activeNativeLiveConversationID != nil,
                    isTurnInFlight:
                        appModel.chatSendState == .sending
                            || pendingOperation != nil,
                    pendingOperation: pendingOperation,
                    runtimeSurface: visibleRuntimeSurface,
                    onResolveRuntimeInteraction: {
                        interaction,
                        response in
                        try await appModel.resolveNativeLiveRuntimeInteraction(
                            interaction,
                            response: response
                        )
                    },
                    onRefresh: {
                        await appModel.refreshNativeLiveCurrentPath(force: true)
                    },
                    onLoadOlder: {
                        await appModel.loadOlderNativeLiveMessages()
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
            pendingOperation = nil
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
                        || pendingOperation != nil,
                isEditing: editDraft != nil,
                onProjectFile: {
                    isComposerFocused = false
                    showingProjectFilePicker = true
                },
                onCancelEdit: cancelEditing
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
            .offset(
                y: isSystemKeyboardVisible
                    ? 0
                    : 10
            )
        }
        .sheet(isPresented: $showingProjectFilePicker) {
            ProjectFilePickerSheet()
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillShowNotification
            )
        ) { _ in
            isSystemKeyboardVisible = true
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillHideNotification
            )
        ) { _ in
            isSystemKeyboardVisible = false
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
    }

    private var visibleRuntimeSurface:
        NativeLiveRuntimeSurfaceState? {
        guard let surface = appModel.nativeLiveRuntimeSurface,
              surface.conversationID
                == appModel.activeNativeLiveConversationID else {
            return nil
        }
        return surface
    }

    private var isConversationLoading: Bool {
        guard pendingOperation == nil,
              !isDraftConversation,
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
        guard pendingOperation == nil,
              appModel.chatSendState != .sending else {
            return
        }

        pendingOperation = NativeLivePendingOperation(
            kind: .retry(
                targetUserMessageID: targetUserMessageID
            ),
            baselineSyncToken:
                appModel.nativeLiveCurrentPath?.syncToken
        )

        Task { @MainActor in
            do {
                try await appModel.retryNativeLiveMessage(
                    targetUserMessageID: targetUserMessageID,
                    execution: executionSelection
                )
            } catch {
            }

            pendingOperation = nil
        }
    }

    private func beginEditing(
        _ message: NativeLiveCurrentPathMessage
    ) {
        guard message.role == "user",
              pendingOperation == nil,
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
        messageText = text

        Task { @MainActor in
            await Task.yield()
            isComposerFocused = true
        }
    }

    private func cancelEditing() {
        editDraft = nil
        messageText = ""
        isComposerFocused = false
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
              pendingOperation == nil,
              !isDraftCommitInFlight,
              appModel.chatSendState != .sending else {
            return
        }

        if let draft = editDraft {
            pendingOperation = NativeLivePendingOperation(
                kind: .edit(
                    targetUserMessageID: draft.targetUserMessageID,
                    text: pendingText
                ),
                baselineSyncToken:
                    appModel.nativeLiveCurrentPath?.syncToken
            )
            editDraft = nil
            messageText = ""
            isComposerFocused = false

            Task { @MainActor in
                do {
                    try await appModel.editNativeLiveMessage(
                        targetUserMessageID: draft.targetUserMessageID,
                        text: pendingText,
                        execution: executionSelection
                    )
                    pendingOperation = nil
                } catch {
                    pendingOperation = nil
                    editDraft = draft

                    if messageText.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty {
                        messageText = pendingText
                    }

                    isComposerFocused = true
                }
            }
            return
        }

        let shouldCreateConversation = isDraftConversation
        pendingOperation = NativeLivePendingOperation(
            kind: .send(text: pendingText),
            baselineSyncToken:
                appModel.nativeLiveCurrentPath?.syncToken
        )
        messageText = ""
        isComposerFocused = false

        Task { @MainActor in
            do {
                if shouldCreateConversation {
                    isDraftCommitInFlight = true
                    _ = try await appModel.createNativeLiveConversation(
                        title: "New Conversation"
                    )

                    if let pendingOperation {
                        self.pendingOperation = pendingOperation.rebased(
                            to: appModel.nativeLiveCurrentPath?.syncToken
                        )
                    }

                    onDraftCommitted()
                }

                try await appModel.sendNativeLiveMessage(
                    pendingText,
                    execution: executionSelection
                )
                pendingOperation = nil
            } catch {
                pendingOperation = nil

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


private struct NativeLiveEditDraft {
    let targetUserMessageID: String
    let text: String
}
