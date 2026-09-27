import SwiftUI

struct ConversationsView: View {
    @EnvironmentObject private var appModel: AppModel

    let onOpenConversation: () -> Void

    @State private var scope:
        ConversationListScope = .active

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
                if scope == .archived {
                    ConversationArchivePlaceholder()
                } else if !appModel.isAuthenticated {
                AppStateSurface(
                    title: "Sign in",
                    actionTitle: "Sign In"
                ) {
                    Task {
                        await reauthorizeAndReload()
                    }
                }
            } else if appModel.nativeLiveConversations.isEmpty {
                switch appModel.conversationBootstrapState {
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
                            await appModel.refreshNativeLiveConversations()
                        }
                    }
                }
                } else {
                    ConversationList(
                        conversations: appModel.nativeLiveConversations,
                        activeConversationID: appModel.activeNativeLiveConversationID,
                        onOpen: { conversation in
                            await open(conversation)
                        },
                        onLoadMore: {
                            await appModel.loadMoreNativeLiveConversations()
                        }
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
        .task {
            guard appModel.isAuthenticated else { return }
            await appModel.refreshNativeLiveConversations()
        }
        .refreshable {
            await appModel.refreshNativeLiveConversations()
        }
    }

    @MainActor
    private func open(
        _ conversation: NativeLiveConversationSummary
    ) async {
        guard let conversationID = UUID(uuidString: conversation.id) else {
            return
        }

        await appModel.openNativeLiveConversation(conversationID)
        onOpenConversation()
    }

    @MainActor
    private func reauthorizeAndReload() async {
        do {
            try await appModel.reauthorize()
            await appModel.refreshNativeLiveConversations()
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

private struct ConversationArchivePlaceholder: View {
    var body: some View {
        AppStateSurface(title: "Unavailable")
    }
}

private struct ConversationList: View {
    let conversations: [NativeLiveConversationSummary]
    let activeConversationID: UUID?
    let onOpen: (NativeLiveConversationSummary) async -> Void
    let onLoadMore: () async -> Void

    var body: some View {
        List(conversations) { conversation in
            HStack(alignment: .center, spacing: 10) {
                Button {
                    Task {
                        await onOpen(conversation)
                    }
                } label: {
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
                .buttonStyle(.plain)

                Menu {
                    Button("Archive") {
                    }
                    .disabled(true)

                    Button(
                        "Delete",
                        role: .destructive
                    ) {
                    }
                    .disabled(true)
                } label: {
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
        // Deliberately empty until main exposes an authoritative
        // last-message timestamp on conversation summaries.
        nil
    }

    private func isActive(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        guard
            let activeConversationID,
            let conversationID = UUID(uuidString: conversation.id)
        else {
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
