import SwiftUI

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var appModel: AppModel

    @State private var selectedPage: AppPage = .chat
    @State private var menuOpen = false
    @State private var settingsPresented = false
    @State private var isDraftConversation = false
    @State private var draftConversationID = UUID()
    @State private var floatingControlCenters: [String: CGFloat] = [:]
    @State private var sidebarDragTranslation: CGFloat = 0

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                iPadLayout
            } else {
                iPhoneLayout
            }
        }
        .tint(.primary)
        .onPreferenceChange(FloatingControlCenterPreferenceKey.self) {
            floatingControlCenters = $0
        }
        .sheet(isPresented: $settingsPresented) {
            SettingsSheetView(appModel: appModel)
        }
    }


    private func beginNewSession() {
        guard appModel.isAuthenticated else {
            return
        }

        draftConversationID = UUID()
        isDraftConversation = true
        selectedPage = .chat
    }

    private func openConversationFromSidebar(
        _ conversation: NativeLiveConversationSummary
    ) {
        guard let conversationID = UUID(uuidString: conversation.id) else {
            return
        }

        isDraftConversation = false

        Task { @MainActor in
            await appModel.openNativeLiveConversation(conversationID)
        }
    }

    private var iPhoneLayout: some View {
        GeometryReader { proxy in
            let revealOffset = min(proxy.size.width * 0.77, 330)
            let cardCornerRadius: CGFloat = menuOpen ? 50 : 0

            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color(red: 0.98, green: 0.98, blue: 0.98))
                    .ignoresSafeArea()

                SidebarView(
                    selectedPage: $selectedPage,
                    menuButtonCenterY: floatingControlCenters[FloatingControlCenter.menu],
                    onNewSession: {
                        withAnimation(.snappy) {
                            menuOpen = false
                        }
                        beginNewSession()
                    },
                    newSessionEnabled:
                        appModel.isAuthenticated,
                    conversations: appModel.nativeLiveConversations,
                    activeConversationID:
                        isDraftConversation
                            ? nil
                            : appModel.activeNativeLiveConversationID,
                    onOpenConversation: openConversationFromSidebar,
                    onSettings: {
                        settingsPresented = true
                    },
                    onSelect: {
                        withAnimation(.snappy) {
                            menuOpen = false
                        }
                    }
                )
                .frame(width: 300)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .safeAreaPadding()

                MainPageLayer(
                    selectedPage: selectedPage,
                    isDraftConversation: isDraftConversation,
                    draftConversationID: draftConversationID,
                    onDraftCommitted: {
                        isDraftConversation = false
                    },
                    onMenu: {
                        withAnimation(.snappy) {
                            menuOpen.toggle()
                        }
                    },
                    onOpenConversation: {
                        selectedPage = .chat
                    }
                )
                .frame(width: proxy.size.width, height: proxy.size.height)
                .background(Color(.systemBackground))
                .clipShape(
                    UnevenRoundedRectangle(
                        topLeadingRadius: cardCornerRadius,
                        bottomLeadingRadius: cardCornerRadius,
                        bottomTrailingRadius: cardCornerRadius,
                        topTrailingRadius: cardCornerRadius,
                        style: .continuous
                    )
                )
                .shadow(
                    color: .black.opacity(menuOpen ? 0.08 : 0),
                    radius: 12,
                    x: -2,
                    y: 4
                )
                .overlay {
                    if menuOpen {
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture {
                                withAnimation(.snappy) {
                                    menuOpen = false
                                }
                        }
                    }
                }
                .offset(
                    x:
                        (menuOpen ? revealOffset : 0)
                        + sidebarDragTranslation
                )
                .simultaneousGesture(
                    sidebarDragGesture(
                        revealOffset: revealOffset
                    )
                )

            }
            .coordinateSpace(name: "sidebar-drag-space")
        }
        .ignoresSafeArea(.container)
    }

    private func sidebarDragGesture(
        revealOffset: CGFloat
    ) -> some Gesture {
        DragGesture(
            minimumDistance: 8,
            coordinateSpace: .named("sidebar-drag-space")
        )
        .onChanged { value in
            guard isSidebarDragEligible(value) else {
                return
            }

            if menuOpen {
                sidebarDragTranslation = max(
                    -revealOffset,
                    min(0, value.translation.width)
                )
            } else {
                sidebarDragTranslation = max(
                    0,
                    min(revealOffset, value.translation.width)
                )
            }
        }
        .onEnded { value in
            guard isSidebarDragEligible(value) else {
                sidebarDragTranslation = 0
                return
            }

            let threshold = revealOffset * 0.33
            let shouldOpen: Bool

            if menuOpen {
                shouldOpen =
                    value.translation.width > -threshold
            } else {
                shouldOpen =
                    value.translation.width > threshold
            }

            withAnimation(.snappy) {
                menuOpen = shouldOpen
                sidebarDragTranslation = 0
            }
        }
    }

    private func isSidebarDragEligible(
        _ value: DragGesture.Value
    ) -> Bool {
        let horizontal = abs(value.translation.width)
        let vertical = abs(value.translation.height)

        guard horizontal > vertical else {
            return false
        }

        if menuOpen {
            return true
        }

        let edgeActivationWidth: CGFloat = 28
        return value.startLocation.x <= edgeActivationWidth
            && value.translation.width > 0
    }

    private var iPadLayout: some View {
        HStack(spacing: 0) {
            SidebarView(
                selectedPage: $selectedPage,
                menuButtonCenterY: nil,
                onNewSession: {
                    beginNewSession()
                },
                newSessionEnabled:
                    appModel.isAuthenticated,
                conversations: appModel.nativeLiveConversations,
                activeConversationID:
                        isDraftConversation
                            ? nil
                            : appModel.activeNativeLiveConversationID,
                onOpenConversation: openConversationFromSidebar,
                onSettings: nil,
                onSelect: {}
            )
            .frame(width: 280)
            .background(Color(red: 0.98, green: 0.98, blue: 0.98))

            Divider()

            PageContainer(
                selectedPage: selectedPage,
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: {
                    isDraftConversation = false
                },
                onMenu: nil,
                onOpenConversation: {
                    selectedPage = .chat
                }
            )
        }
    }
}

private struct MainPageLayer: View {
    let selectedPage: AppPage
    let isDraftConversation: Bool
    let draftConversationID: UUID
    let onDraftCommitted: () -> Void
    let onMenu: () -> Void
    let onOpenConversation: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            PageContainer(
                selectedPage: selectedPage,
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: onDraftCommitted,
                onMenu: onMenu,
                onOpenConversation: onOpenConversation
            )
        }
    }
}
