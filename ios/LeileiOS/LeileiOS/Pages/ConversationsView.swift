import SwiftUI

struct ConversationsView: View {
    @EnvironmentObject private var appModel: AppModel

    let onOpenConversation: () -> Void

    @State private var scope:
        ConversationListScope = .active
    @State private var pendingDelete:
        NativeLiveConversationSummary?
    @State private var lifecycleErrorMessage: String?
    @State private var lifecycleMutationIDs: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            Picker("Scope", selection: $scope) {
                ForEach(ConversationListScope.allCases) { scope in
                    Text(scope.title)
                        .tag(scope)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, LeileiUI.Gutter.page)
            .padding(.top, 8)
            .padding(.bottom, 10)

            Group {
                if !appModel.isAuthenticated {
                    AppStateSurface(
                        title: "Sign in",
                        actionTitle: "Sign In"
                    ) {
                        Task {
                            await reauthorizeAndReload()
                        }
                    }
                } else {
                    conversationContent
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task {
            guard appModel.isAuthenticated else { return }
            await refreshCurrentScope()
        }
        .onChange(of: scope) { _, _ in
            Task {
                await refreshCurrentScope()
            }
        }
        .refreshable {
            await refreshCurrentScope()
        }
        .alert(
            "Delete conversation?",
            isPresented: Binding(
                get: { pendingDelete != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingDelete = nil
                    }
                }
            )
        ) {
            Button("Cancel", role: .cancel) {
                pendingDelete = nil
            }

            Button("Delete", role: .destructive) {
                guard let conversation = pendingDelete else {
                    return
                }
                pendingDelete = nil
                Task {
                    await delete(conversation)
                }
            }
        } message: {
            Text(
                "This conversation will be permanently deleted. "
                + "This can’t be undone."
            )
        }
        .alert(
            "Failed",
            isPresented: Binding(
                get: { lifecycleErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        lifecycleErrorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                lifecycleErrorMessage = nil
            }
        } message: {
            Text(lifecycleErrorMessage ?? "")
        }
    }

    @ViewBuilder
    private var conversationContent: some View {
        switch scope {
        case .active:
            listContent(
                conversations: appModel.nativeLiveConversations,
                state: appModel.conversationBootstrapState
            )
        case .archived:
            listContent(
                conversations: appModel.nativeLiveArchivedConversations,
                state: appModel.archivedConversationBootstrapState
            )
        }
    }

    @ViewBuilder
    private func listContent(
        conversations: [NativeLiveConversationSummary],
        state: AppModel.ConversationBootstrapState
    ) -> some View {
        if conversations.isEmpty {
            switch state {
            case .idle, .loading:
                ConversationListSkeleton()

            case .ready:
                AppStateSurface(title: "Nothing here")

            case .unavailable:
                AppStateSurface(
                    title: "Unavailable",
                    actionTitle: "Retry"
                ) {
                    Task {
                        await refreshCurrentScope()
                    }
                }
            }
        } else {
            ConversationList(
                scope: scope,
                conversations: conversations,
                activeConversationID:
                    scope == .active
                        ? appModel.activeNativeLiveConversationID
                        : nil,
                activeTurnInFlight:
                    appModel.chatSendState == .sending,
                lifecycleMutationIDs:
                    lifecycleMutationIDs,
                onOpen: { conversation in
                    await open(conversation)
                },
                onArchive: { conversation in
                    await archive(conversation)
                },
                onRestore: { conversation in
                    await restore(conversation)
                },
                onDelete: { conversation in
                    guard canMutate(conversation) else {
                        return
                    }
                    pendingDelete = conversation
                },
                onLoadMore: {
                    await loadMoreCurrentScope()
                }
            )
        }
    }

    @MainActor
    private func open(
        _ conversation: NativeLiveConversationSummary
    ) async {
        guard scope == .active,
              let conversationID = UUID(uuidString: conversation.id) else {
            return
        }

        await appModel.openNativeLiveConversation(conversationID)
        onOpenConversation()
    }

    @MainActor
    private func archive(
        _ conversation: NativeLiveConversationSummary
    ) async {
        guard let conversationID = UUID(uuidString: conversation.id),
              canMutate(conversation) else {
            return
        }

        lifecycleMutationIDs.insert(conversation.id)
        defer {
            lifecycleMutationIDs.remove(conversation.id)
        }

        do {
            try await appModel.archiveNativeLiveConversation(
                conversationID: conversationID
            )
        } catch {
            lifecycleErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func restore(
        _ conversation: NativeLiveConversationSummary
    ) async {
        guard let conversationID = UUID(uuidString: conversation.id),
              canMutate(conversation) else {
            return
        }

        lifecycleMutationIDs.insert(conversation.id)
        defer {
            lifecycleMutationIDs.remove(conversation.id)
        }

        do {
            try await appModel.restoreNativeLiveConversation(
                conversationID: conversationID
            )
        } catch {
            lifecycleErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(
        _ conversation: NativeLiveConversationSummary
    ) async {
        guard let conversationID = UUID(uuidString: conversation.id),
              canMutate(conversation) else {
            return
        }

        lifecycleMutationIDs.insert(conversation.id)
        defer {
            lifecycleMutationIDs.remove(conversation.id)
        }

        do {
            try await appModel.deleteNativeLiveConversation(
                conversationID: conversationID
            )
        } catch {
            lifecycleErrorMessage = error.localizedDescription
        }
    }

    private func canMutate(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        guard !lifecycleMutationIDs.contains(conversation.id) else {
            return false
        }

        guard scope == .active,
              appModel.chatSendState == .sending,
              let activeID = appModel.activeNativeLiveConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return true
        }

        return activeID != conversationID
    }

    @MainActor
    private func refreshCurrentScope() async {
        guard appModel.isAuthenticated else { return }

        switch scope {
        case .active:
            await appModel.refreshNativeLiveConversations()
        case .archived:
            await appModel.refreshNativeLiveArchivedConversations()
        }
    }

    @MainActor
    private func loadMoreCurrentScope() async {
        switch scope {
        case .active:
            await appModel.loadMoreNativeLiveConversations()
        case .archived:
            await appModel.loadMoreNativeLiveArchivedConversations()
        }
    }

    @MainActor
    private func reauthorizeAndReload() async {
        do {
            try await appModel.reauthorize()
            await refreshCurrentScope()
        } catch {
            return
        }
    }
}

enum ConversationListScope:
    String,
    CaseIterable,
    Identifiable {
    case active
    case archived

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active:
            return "Active"
        case .archived:
            return "Archive"
        }
    }
}

