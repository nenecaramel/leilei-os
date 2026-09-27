import SwiftUI

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var inheritedColorScheme
    @EnvironmentObject private var appModel: AppModel

    @State private var selectedPage: AppPage = .chat
    @State private var universeTargetNodeID: String?
    @State private var menuOpen = false
    @State private var settingsPresented = false
    @State private var isDraftConversation = false
    @State private var draftConversationID = UUID()
    @State private var sidebarSearchCenterY: CGFloat?
    @State private var sidebarDragTranslation: CGFloat = 0

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                iPadLayout
            } else {
                iPhoneLayout
            }
        }
        .environment(\.colorScheme, shellColorScheme)
        .tint(.primary)
        .onPreferenceChange(FloatingControlCenterPreferenceKey.self) { centers in
            guard selectedPage == .chat,
                  let centerY = centers[FloatingControlCenter.menu]
            else {
                return
            }

            sidebarSearchCenterY = centerY
        }
        .sheet(isPresented: $settingsPresented) {
            SettingsSheetView(
                appModel: appModel,
                dataService: LeileiSettingsDataService(api: appModel.api)
            )
            .environment(
                \.colorScheme,
                inheritedColorScheme
            )
        }
    }

    private var isUniverseTheme: Bool {
        selectedPage == .universe
    }

    private var shellColorScheme: ColorScheme {
        isUniverseTheme ? .dark : inheritedColorScheme
    }

    private var universeBackground: Color {
        Color(
            red: 11.0 / 255.0,
            green: 12.0 / 255.0,
            blue: 18.0 / 255.0
        )
    }

    private var shellBackground: Color {
        isUniverseTheme
            ? universeBackground
            : Color(.systemBackground)
    }

    private var sidebarBackground: Color {
        isUniverseTheme
            ? universeBackground
            : Color(
                red: 0.98,
                green: 0.98,
                blue: 0.98
            )
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
                    .fill(sidebarBackground)
                    .ignoresSafeArea()

                SidebarView(
                    selectedPage: $selectedPage,
                    menuButtonCenterY: sidebarSearchCenterY,
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
                    universeTargetNodeID: universeTargetNodeID,
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
                    },
                    onOpenUniverseNode: { nodeID in
                        universeTargetNodeID = nodeID
                        selectedPage = .universe
                    },
                    onUniverseTargetConsumed: {
                        universeTargetNodeID = nil
                    }
                )
                .frame(width: proxy.size.width, height: proxy.size.height)
                .background(shellBackground)
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
            .background(sidebarBackground)

            Divider()

            PageContainer(
                selectedPage: selectedPage,
                universeTargetNodeID: universeTargetNodeID,
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: {
                    isDraftConversation = false
                },
                onMenu: nil,
                onOpenConversation: {
                    selectedPage = .chat
                },
                onOpenUniverseNode: { nodeID in
                    universeTargetNodeID = nodeID
                    selectedPage = .universe
                },
                onUniverseTargetConsumed: {
                    universeTargetNodeID = nil
                }
            )
        }
    }
}

private struct MainPageLayer: View {
    let selectedPage: AppPage
    let universeTargetNodeID: String?
    let isDraftConversation: Bool
    let draftConversationID: UUID
    let onDraftCommitted: () -> Void
    let onMenu: () -> Void
    let onOpenConversation: () -> Void
    let onOpenUniverseNode: (String) -> Void
    let onUniverseTargetConsumed: () -> Void

    private var pageBackground: Color {
        if selectedPage == .universe {
            return Color(
                red: 11.0 / 255.0,
                green: 12.0 / 255.0,
                blue: 18.0 / 255.0
            )
        }

        return Color(.systemBackground)
    }

    var body: some View {
        ZStack {
            pageBackground
                .ignoresSafeArea()

            PageContainer(
                selectedPage: selectedPage,
                universeTargetNodeID: universeTargetNodeID,
                isDraftConversation: isDraftConversation,
                draftConversationID: draftConversationID,
                onDraftCommitted: onDraftCommitted,
                onMenu: onMenu,
                onOpenConversation: onOpenConversation,
                onOpenUniverseNode: onOpenUniverseNode,
                onUniverseTargetConsumed: onUniverseTargetConsumed
            )
        }
    }
}
