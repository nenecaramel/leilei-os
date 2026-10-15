import SwiftUI
import UIKit

struct PageContainer: View {
    @EnvironmentObject private var appModel: AppModel

    // Supplemental wallpaper behind NavigationStack content fills exposed
    // keyboard corners. ChatView still owns the primary visible wallpaper
    // and the composer remains responsible for its own keyboard avoidance.
    @AppStorage(ChatTheme.storageKey) private var chatThemeRawValue =
        ChatTheme.original.rawValue
    @AppStorage(IMessageWallpaper.revisionKey) private var wallpaperRevision = ""
    @State private var chatWallpaperImage: UIImage?

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
        // Universe extends its map beneath the transparent navigation bar.
        NavigationStack {
            pageContent
            // Place the keyboard-safe wallpaper immediately behind the
            // navigation content, not outside NavigationStack, whose own
            // system background can otherwise hide the custom image.
            .background {
                if selectedPage == .chat,
                   chatThemeRawValue == ChatTheme.iMessage.rawValue,
                   let chatWallpaperImage {
                    GeometryReader { geometry in
                        Image(uiImage: chatWallpaperImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped()
                    }
                    .ignoresSafeArea(.container)
                    .ignoresSafeArea(.keyboard, edges: .bottom)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
                }
            }
            .navigationTitle(selectedPage == .chat || selectedPage == .universe ? "" : pageTitle)
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

                if selectedPage == .universe {
                    ToolbarItem(placement: .principal) {
                        Text(pageTitle)
                            .font(.headline)
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
        .task(id: wallpaperRevision) {
            chatWallpaperImage = IMessageWallpaper.load()
        }
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
        .appFailureAlert(
            message: renameErrorMessage ?? "The conversation could not be renamed.",
            isPresented: Binding(
                get: { renameErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        renameErrorMessage = nil
                    }
                }
            )
        )
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
        .appFailureAlert(
            message: deleteErrorMessage ?? "The conversation could not be deleted.",
            isPresented: Binding(
                get: { deleteErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        deleteErrorMessage = nil
                    }
                }
            )
        )
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
        switch selectedPage {
        case .chat:
            ChatView(
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: onDraftCommitted
            )

        case .globalSearch:
            GlobalSearchView(
                service: LeileiGlobalSearchService(api: appModel.api),
                onOpenDiary: onOpenDiary,
                onOpenDaySpace: onOpenDaySpace,
                onOpenUniverseNode: onOpenUniverseNode
            )

        case .diary:
            DiaryView(
                target: diaryTarget,
                onTargetConsumed: onDiaryTargetConsumed
            )

        case .daySpace:
            DaySpaceView(
                target: daySpaceTarget,
                onTargetConsumed: onDaySpaceTargetConsumed
            )

        case .mind:
            MindView()

        case .universe:
            UniverseView(
                targetNodeID: universeTargetNodeID,
                onTargetConsumed: onUniverseTargetConsumed
            )

        case .conversations:
            ConversationsView(
                onOpenConversation: onOpenConversation
            )
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
