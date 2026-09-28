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
    @State private var workspaces: [WorkspaceSummary] = []
    @State private var selectedWorkspaceID: String?
    @State private var editDraft: NativeLiveEditDraft?
    @State private var pendingOperation: NativeLivePendingOperation?
    @State private var isDraftCommitInFlight = false
    @State private var isRuntimeControlInFlight = false
    @State private var isSystemKeyboardVisible = false
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
            await refreshWorkspaces()
            await appModel.refreshNativeLiveConversations()
            guard !isDraftConversation else { return }
            await appModel.refreshNativeLiveCurrentPath()
        }
        .task(id: foregroundSyncTaskID) {
            await observeForegroundConversationChanges()
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
            if isDraftConversation {
                normalizeSelectedWorkspace()
            }
            isComposerFocused = false
        }
        .onChange(of: appModel.activeNativeLiveWorkspaceID) { _, workspaceID in
            guard !isDraftConversation else { return }
            selectedWorkspaceID = workspaceID
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
                isRuntimeTurnActive:
                    visibleRuntimeSurface != nil
                        && pendingOperation != nil,
                isRuntimeControlInFlight:
                    isRuntimeControlInFlight,
                interruptRequested:
                    runtimeInterruptRequested,
                isEditing: editDraft != nil,
                onCancelEdit: cancelEditing,
                onInterrupt: {
                    interruptCurrentTurn()
                },
                onMidTurnInput: { text in
                    sendMidTurnInput(text)
                }
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
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                workspaceMenu
            }
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

    private var foregroundSyncTaskID: String {
        let conversation =
            appModel.activeNativeLiveConversationID?
                .uuidString.lowercased()
            ?? "none"
        let phase =
            scenePhase == .active
                ? "active"
                : "inactive"
        return "\(conversation):\(phase):\(isDraftConversation)"
    }

    @MainActor
    private func observeForegroundConversationChanges() async {
        guard scenePhase == .active,
              !isDraftConversation,
              appModel.isAuthenticated,
              let conversationID =
                appModel.activeNativeLiveConversationID
        else {
            return
        }

        while !Task.isCancelled,
              scenePhase == .active,
              !isDraftConversation,
              appModel.isAuthenticated,
              appModel.activeNativeLiveConversationID
                == conversationID {
            try? await Task.sleep(
                for: .seconds(12)
            )
            guard !Task.isCancelled else {
                return
            }

            guard pendingOperation == nil,
                  appModel.chatSendState != .sending,
                  visibleRuntimeSurface == nil else {
                continue
            }

            await appModel.refreshNativeLiveCurrentPath(
                surfaceTransientFailure: false
            )
        }
    }

    private var selectedWorkspaceName: String {
        guard let selectedWorkspaceID,
              let workspace = workspaces.first(where: {
                  $0.id == selectedWorkspaceID
              }) else {
            return "Workspace"
        }
        return workspace.name
    }

    private var workspaceMenu: some View {
        Menu {
            Picker(
                "Workspace",
                selection: $selectedWorkspaceID
            ) {
                Text("No Workspace")
                    .tag(String?.none)

                ForEach(workspaces) { workspace in
                    Text(workspace.name)
                        .tag(Optional(workspace.id))
                }
            }
            .disabled(!workspaceSelectionEnabled)
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "folder")
                    .font(.system(size: 14, weight: .regular))

                Text(selectedWorkspaceName)
                    .font(.system(size: 13, weight: .regular))
                    .lineLimit(1)
            }
        }
        .accessibilityLabel(
            "Workspace, \(selectedWorkspaceName)"
        )
    }

    private var workspaceSelectionEnabled: Bool {
        if isDraftConversation {
            return true
        }
        guard appModel.activeNativeLiveWorkspaceID == nil else {
            return false
        }
        return appModel.nativeLiveCurrentPath?.currentHeadMessageId == nil
    }

    @MainActor
    private func refreshWorkspaces() async {
        do {
            workspaces = try await appModel.api.workspaces()
            if isDraftConversation {
                normalizeSelectedWorkspace()
            } else if let bound = appModel.activeNativeLiveWorkspaceID {
                selectedWorkspaceID = bound
            } else if appModel.nativeLiveCurrentPath?.currentHeadMessageId == nil {
                normalizeSelectedWorkspace()
            }
        } catch {
            workspaces = []
            if isDraftConversation {
                selectedWorkspaceID = nil
            }
        }
    }

    private func normalizeSelectedWorkspace() {
        if let selectedWorkspaceID,
           workspaces.contains(where: { $0.id == selectedWorkspaceID }) {
            return
        }
        selectedWorkspaceID = workspaces.first?.id
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

    private var runtimeInterruptRequested: Bool {
        visibleRuntimeSurface?.controls.contains {
            $0.kind == "interrupt"
                && $0.status != "failed"
        } == true
    }

    private func sendMidTurnInput(
        _ text: String
    ) {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty,
              !isRuntimeControlInFlight,
              visibleRuntimeSurface != nil else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                try await appModel.sendNativeLiveMidTurnInput(
                    normalized
                )

                if messageText.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ) == normalized {
                    messageText = ""
                }
                isComposerFocused = true
            } catch {
                // Preserve the typed text. The control may be retried
                // explicitly by the user; never blind-retry an ambiguous send.
            }
        }
    }

    private func interruptCurrentTurn() {
        guard !isRuntimeControlInFlight,
              !runtimeInterruptRequested,
              visibleRuntimeSurface != nil else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                try await appModel.interruptNativeLiveTurn()
            } catch {
                // Never blind-retry an interrupt with unknown delivery.
            }
        }
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

                let shouldBindWorkspace =
                    shouldCreateConversation
                    || appModel.nativeLiveCurrentPath?
                        .currentHeadMessageId == nil
                try await appModel.sendNativeLiveMessage(
                    pendingText,
                    workspaceID:
                        shouldBindWorkspace
                            ? selectedWorkspaceID
                            : nil,
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
