import SwiftUI

struct PageContainer: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var renameDraft: ConversationRenameDraft?
    @State private var showingDeleteConfirmation = false
    @State private var deleteErrorMessage: String?

    let selectedPage: AppPage
    let onMenu: (() -> Void)?
    let onOpenConversation: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if selectedPage == .chat {
                    ChatView()
                } else if selectedPage == .globalSearch {
                    GlobalSearchView()
                } else if selectedPage == .diary {
                    DiaryView()
                } else if selectedPage == .daySpace {
                    DaySpaceView()
                } else if selectedPage == .conversations {
                    ConversationsView(
                        onOpenConversation: onOpenConversation
                    )
                } else {
                    PlaceholderPage(page: selectedPage)
                }
            }
            .navigationTitle(pageTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            CompactMenuIcon()
                        }
                        .reportingFloatingControlCenter(FloatingControlCenter.menu)
                    }
                }

                if selectedPage != .globalSearch
                    && selectedPage != .diary
                    && selectedPage != .daySpace
                    && selectedPage != .conversations {
                    ToolbarItem(placement: .topBarTrailing) {
                        if selectedPage == .chat {
                            Menu {
                                Button {
                                    guard appModel.activeNativeLiveConversationID != nil else {
                                        return
                                    }
                                    renameDraft = ConversationRenameDraft(
                                        title: activeConversationEditableTitle
                                    )
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }
                                .disabled(
                                    appModel.activeNativeLiveConversationID == nil
                                )

                                Button(role: .destructive) {
                                    showingDeleteConfirmation = true
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                .disabled(
                                    appModel.activeNativeLiveConversationID == nil
                                        || appModel.chatSendState == .sending
                                )
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 18, weight: .medium))
                            }
                            .accessibilityLabel("Conversation menu")
                        } else {
                            Button {
                            } label: {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 18, weight: .medium))
                            }
                        }
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .background(Color(.systemBackground).ignoresSafeArea())
        .sheet(item: $renameDraft) { draft in
            NativeLiveRenameSheet(
                initialTitle: draft.title
            ) { title in
                try await appModel.renameActiveNativeLiveConversation(title)
            }
            .presentationDetents([.height(210)])
        }
        .confirmationDialog(
            "Delete conversation?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { @MainActor in
                    do {
                        try await appModel.deleteActiveNativeLiveConversation()
                    } catch {
                        deleteErrorMessage = error.localizedDescription
                    }
                }
            }

            Button("Cancel", role: .cancel) {
            }
        } message: {
            Text("This conversation will be removed from Recents.")
        }
        .alert(
            "Delete failed",
            isPresented: Binding(
                get: { deleteErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        deleteErrorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                deleteErrorMessage = nil
            }
        } message: {
            Text(deleteErrorMessage ?? "")
        }
    }

    private var pageTitle: String {
        guard selectedPage == .chat else {
            return selectedPage.rawValue
        }
        return activeConversationTitle
    }

    private var activeConversationEditableTitle: String {
        if let activeConversationID = appModel.activeNativeLiveConversationID,
           let conversation = appModel.nativeLiveConversations.first(where: {
               guard let id = UUID(uuidString: $0.id) else { return false }
               return id == activeConversationID
           }),
           let title = normalizedTitle(conversation.title) {
            return title
        }

        if let title = normalizedTitle(appModel.nativeLiveCurrentPath?.title) {
            return title
        }

        return ""
    }

    private var activeConversationTitle: String {
        if let activeConversationID = appModel.activeNativeLiveConversationID,
           let conversation = appModel.nativeLiveConversations.first(where: {
               guard let id = UUID(uuidString: $0.id) else { return false }
               return id == activeConversationID
           }),
           let title = normalizedTitle(conversation.title) {
            return title
        }

        if let title = normalizedTitle(appModel.nativeLiveCurrentPath?.title) {
            return title
        }

        return "New Conversation"
    }

    private func normalizedTitle(_ title: String?) -> String? {
        guard let title else { return nil }
        let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}


private struct ConversationRenameDraft: Identifiable {
    let id = UUID()
    let title: String
}

private struct NativeLiveRenameSheet: View {
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    let onSave: (String) async throws -> Void

    init(
        initialTitle: String,
        onSave: @escaping (String) async throws -> Void
    ) {
        _title = State(initialValue: initialTitle)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Conversation name", text: $title)
                    .textFieldStyle(.roundedBorder)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 0)
            }
            .padding(16)
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .disabled(!canSave || isSaving)
                }
            }
        }
    }

    private var canSave: Bool {
        let normalized = title.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !normalized.isEmpty && normalized.count <= 200
    }

    private func save() {
        guard canSave, !isSaving else { return }

        isSaving = true
        errorMessage = nil

        Task { @MainActor in
            do {
                try await onSave(title)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSaving = false
            }
        }
    }
}


private struct CompactMenuIcon: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            line(width: 17)
            line(width: 17)
            line(width: 10)
        }
        .frame(width: 17, height: 14, alignment: .leading)
        .accessibilityLabel("Menu")
    }

    private func line(width: CGFloat) -> some View {
        Capsule()
            .fill(Color.primary)
            .frame(width: width, height: 2)
    }
}
