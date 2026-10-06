import SwiftUI
import UIKit

struct PageContainer: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var renameTitle = ""
    @State private var showingRenameAlert = false
    @State private var renameErrorMessage: String?
    @State private var showingDeleteConfirmation = false
    @State private var deleteErrorMessage: String?
    @State private var showingContext = false
    @State private var showingClaudeUsage = false
    @State private var showingClaudeSessions = false

    let selectedPage: AppPage
    let diaryTarget: DiaryNavigationTarget?
    let daySpaceTarget: DaySpaceNavigationTarget?
    let universeTargetNodeID: String?
    let isDraftConversation: Bool
    let draftConversationID: UUID
    let onDraftCommitted: () -> Void
    let onMenu: (() -> Void)?
    let onOpenConversation: () -> Void
    let onOpenDiary: (DiaryNavigationTarget) -> Void
    let onDiaryTargetConsumed: () -> Void
    let onOpenDaySpace: (DaySpaceNavigationTarget) -> Void
    let onDaySpaceTargetConsumed: () -> Void
    let onOpenUniverseNode: (String) -> Void
    let onUniverseTargetConsumed: () -> Void

    var body: some View {
        // Single navigation and edge-background owner for all main pages.
        // Content keeps its safe area; only the backdrop extends beyond it.
        NavigationStack {
            pageContent
            .navigationTitle(selectedPage == .chat ? "" : pageTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            CompactMenuIcon()
                        }
                        .reportingFloatingControlCenter(
                            FloatingControlCenter.menu
                        )
                    }
                }

                if selectedPage == .chat {
                    ToolbarItem(placement: .topBarTrailing) {
                        conversationMenu
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .background(pageBackground.ignoresSafeArea())
        .sheet(isPresented: $showingContext) {
            ContextOverviewSheet()
        }
        .sheet(isPresented: $showingClaudeUsage) {
            ClaudeUsageSheet(api: appModel.api)
        }
        .sheet(isPresented: $showingClaudeSessions) {
            ClaudeSessionForkSheet {
                onDraftCommitted()
                onOpenConversation()
            }
        }
        .alert(
            "Rename",
            isPresented: $showingRenameAlert
        ) {
            TextField("New name", text: $renameTitle)
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
            Text("Enter a new name")
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
            message: "This conversation will be permanently deleted. This can’t be undone.",
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

    private var conversationMenu: some View {
        Menu {
            conversationMenuContent
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .medium))
        }
        .accessibilityLabel("Conversation menu")
    }

    @ViewBuilder
    private var conversationMenuContent: some View {
        Button {
            showingClaudeUsage = true
        } label: {
            Label("Claude Usage", systemImage: "gauge.with.dots.needle.50percent")
        }

        Button {
            showingContext = true
        } label: {
            Label("Context", systemImage: "chart.bar")
        }

        Button {
            showingClaudeSessions = true
        } label: {
            Label(
                "Fork Session",
                systemImage: "arrow.triangle.branch"
            )
        }
        .disabled(
            !appModel.isAuthenticated
                || appModel.chatSendState == .sending
        )

        Button {
            guard appModel.activeNativeLiveConversationID != nil else {
                return
            }
            renameTitle = activeConversationEditableTitle
            showingRenameAlert = true
        } label: {
            Label("Rename", systemImage: "pencil")
        }
        .disabled(appModel.activeNativeLiveConversationID == nil)

        Divider()

        Button(role: .destructive) {
            showingDeleteConfirmation = true
        } label: {
            Label {
                Text("Delete")
                    .foregroundStyle(.red)
            } icon: {
                destructiveTrashIcon
            }
        }
        .disabled(
            appModel.activeNativeLiveConversationID == nil
                || appModel.chatSendState == .sending
        )
    }

    private var destructiveTrashIcon: Image {
        let image =
            UIImage(systemName: "trash")?
                .withTintColor(
                    .systemRed,
                    renderingMode: .alwaysOriginal
                )
            ?? UIImage()
        return Image(uiImage: image)
    }

    @ViewBuilder
    private var pageContent: some View {
        if selectedPage == .chat {
            ChatView(
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: onDraftCommitted
            )
        } else if selectedPage == .globalSearch {
            GlobalSearchView(
                service: LeileiGlobalSearchService(api: appModel.api),
                onOpenDiary: onOpenDiary,
                onOpenDaySpace: onOpenDaySpace,
                onOpenUniverseNode: onOpenUniverseNode
            )
        } else if selectedPage == .diary {
            DiaryView(
                target: diaryTarget,
                onTargetConsumed: onDiaryTargetConsumed
            )
        } else if selectedPage == .daySpace {
            DaySpaceView(
                target: daySpaceTarget,
                onTargetConsumed: onDaySpaceTargetConsumed
            )
        } else if selectedPage == .mind {
            MindView()
        } else if selectedPage == .universe {
            UniverseView(
                targetNodeID: universeTargetNodeID,
                onTargetConsumed: onUniverseTargetConsumed
            )
        } else if selectedPage == .conversations {
            ConversationsView(
                onOpenConversation: onOpenConversation
            )
        } else {
            PlaceholderPage(page: selectedPage)
        }
    }

    private var pageBackground: Color {
        if selectedPage == .universe {
            return UniversePalette.background
        }

        return LeileiUI.Color.pageBackground
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
