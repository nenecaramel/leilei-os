import SwiftUI

struct PageContainer: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var renameTitle = ""
    @State private var showingRenameAlert = false
    @State private var renameErrorMessage: String?
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
                                    renameTitle = activeConversationEditableTitle
                                    showingRenameAlert = true
                                } label: {
                                    Text("Rename")
                                }
                                .disabled(
                                    appModel.activeNativeLiveConversationID == nil
                                )

                                Button(role: .destructive) {
                                    showingDeleteConfirmation = true
                                } label: {
                                    Text("Delete")
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
        .alert(
            "Rename conversation",
            isPresented: $showingRenameAlert
        ) {
            TextField("Title", text: $renameTitle)
                .textInputAutocapitalization(.sentences)

            Button("Cancel", role: .cancel) {
            }

            Button("Save") {
                let title = renameTitle.trimmingCharacters(
                    in: .whitespacesAndNewlines
                )
                Task { @MainActor in
                    do {
                        try await appModel
                            .renameActiveNativeLiveConversation(title)
                    } catch {
                        renameErrorMessage = error.localizedDescription
                    }
                }
            }
            .disabled(!canRename)
        } message: {
            Text("Enter a new title for this conversation.")
        }
        .alert(
            "Rename failed",
            isPresented: Binding(
                get: { renameErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        renameErrorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                renameErrorMessage = nil
            }
        } message: {
            Text(renameErrorMessage ?? "")
        }
        .appConfirmationAlert(
            title: "Delete conversation?",
            message: "This conversation will be removed from Recents.",
            actionTitle: "Delete",
            actionRole: .destructive,
            isPresented: $showingDeleteConfirmation
        ) {
            Task { @MainActor in
                do {
                    try await appModel.deleteActiveNativeLiveConversation()
                } catch {
                    deleteErrorMessage = error.localizedDescription
                }
            }
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

    private var canRename: Bool {
        let normalized = renameTitle.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return !normalized.isEmpty && normalized.count <= 200
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
