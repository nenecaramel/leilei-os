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
            .padding(.horizontal, 16)
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
        .background(Color(.systemBackground))
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

private enum ConversationListScope:
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

private struct ConversationList: View {
    let scope: ConversationListScope
    let conversations: [NativeLiveConversationSummary]
    let activeConversationID: UUID?
    let activeTurnInFlight: Bool
    let lifecycleMutationIDs: Set<String>
    let onOpen: (NativeLiveConversationSummary) async -> Void
    let onArchive: (NativeLiveConversationSummary) async -> Void
    let onRestore: (NativeLiveConversationSummary) async -> Void
    let onDelete: (NativeLiveConversationSummary) -> Void
    let onLoadMore: () async -> Void

    var body: some View {
        List(conversations) { conversation in
            HStack(alignment: .center, spacing: 10) {
                if scope == .active {
                    Button {
                        Task {
                            await onOpen(conversation)
                        }
                    } label: {
                        rowContent(conversation)
                    }
                    .buttonStyle(.plain)
                } else {
                    rowContent(conversation)
                }

                Menu {
                    switch scope {
                    case .active:
                        Button("Archive") {
                            Task {
                                await onArchive(conversation)
                            }
                        }
                        .disabled(isMutationDisabled(conversation))

                    case .archived:
                        Button("Restore") {
                            Task {
                                await onRestore(conversation)
                            }
                        }
                        .disabled(isMutationDisabled(conversation))
                    }

                    Button(
                        "Delete",
                        role: .destructive
                    ) {
                        onDelete(conversation)
                    }
                    .disabled(isMutationDisabled(conversation))
                } label: {
                    if lifecycleMutationIDs.contains(conversation.id) {
                        ProgressView()
                            .controlSize(.small)
                            .frame(
                                width: 28,
                                height: 28
                            )
                    } else {
                        Image(systemName: "ellipsis")
                            .font(.system(
                                size: 16,
                                weight: .medium
                            ))
                            .frame(
                                width: 28,
                                height: 28
                            )
                    }
                }
                .accessibilityLabel(
                    "Conversation actions"
                )
            }
            .listRowBackground(Color(.systemBackground))
            .onAppear {
                guard conversation.id == conversations.last?.id else {
                    return
                }
                Task {
                    await onLoadMore()
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }

    private func isMutationDisabled(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        if lifecycleMutationIDs.contains(conversation.id) {
            return true
        }

        guard scope == .active,
              activeTurnInFlight,
              let activeConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return false
        }

        return activeConversationID == conversationID
    }

    private func rowContent(
        _ conversation: NativeLiveConversationSummary
    ) -> some View {
        HStack(
            alignment: .center,
            spacing: 12
        ) {
            VStack(
                alignment: .leading,
                spacing: 4
            ) {
                Text(
                    displayTitle(
                        for: conversation
                    )
                )
                .font(.body)
                .foregroundStyle(.primary)
                .lineLimit(1)

                if let subtitle =
                        lastMessageDateText(
                            for: conversation
                        ) {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(
                maxWidth: .infinity,
                alignment: .leading
            )

            if isActive(conversation) {
                Image(systemName: "checkmark")
                    .font(.system(
                        size: 13,
                        weight: .semibold
                    ))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(
                        "Current conversation"
                    )
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private func displayTitle(
        for conversation: NativeLiveConversationSummary
    ) -> String {
        let title = conversation.title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return title?.isEmpty == false ? title! : "New Conversation"
    }

    private func lastMessageDateText(
        for conversation: NativeLiveConversationSummary
    ) -> String? {
        guard let value = conversation.lastMessageAt else {
            return nil
        }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]

        guard let date = fractional.date(from: value)
            ?? standard.date(from: value) else {
            return nil
        }

        if Calendar.current.isDate(
            date,
            equalTo: .now,
            toGranularity: .year
        ) {
            return date.formatted(
                .dateTime
                    .month(.abbreviated)
                    .day()
            )
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .year()
        )
    }

    private func isActive(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        guard scope == .active,
              let activeConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return false
        }
        return activeConversationID == conversationID
    }
}

private struct ConversationListSkeleton: View {
    var body: some View {
        List(0..<6, id: \.self) { index in
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(
                    cornerRadius: 6,
                    style: .continuous
                )
                .fill(Color.secondary.opacity(0.12))
                .frame(
                    width:
                        index.isMultiple(of: 2)
                            ? 190
                            : 240,
                    height: 17
                )

                RoundedRectangle(
                    cornerRadius: 5,
                    style: .continuous
                )
                .fill(Color.secondary.opacity(0.08))
                .frame(width: 76, height: 11)
            }
            .padding(.vertical, 6)
            .listRowBackground(Color(.systemBackground))
            .accessibilityHidden(true)
        }
        .listStyle(.plain)
        .scrollDisabled(true)
        .scrollContentBackground(.hidden)
        .background(Color(.systemBackground))
    }
}

struct ConversationCreateSheet: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let onCreated: () -> Void

    @State private var title = ""
    @State private var isCreating = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title (optional)", text: $title)
                    .textInputAutocapitalization(.sentences)

                if failed {
                    Text("Failed")
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("New Session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isCreating)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        Task {
                            await create()
                        }
                    }
                    .disabled(isCreating)
                }
            }
        }
        .presentationDetents([.medium])
    }

    @MainActor
    private func create() async {
        guard !isCreating else { return }

        isCreating = true
        failed = false
        defer {
            isCreating = false
        }

        let normalized = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        do {
            _ = try await appModel.createNativeLiveConversation(
                title: normalized.isEmpty ? nil : normalized
            )
            dismiss()
            onCreated()
        } catch {
            failed = true
        }
    }
}
