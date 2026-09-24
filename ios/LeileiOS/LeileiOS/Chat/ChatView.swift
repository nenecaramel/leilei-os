import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var messageText = ""
    @State private var model = "Opus 5"
    @State private var effort = "High"
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
                    appModel.activeNativeLiveConversationID != nil
            ) {
                await appModel.refreshNativeLiveCurrentPath(force: true)
            }
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
