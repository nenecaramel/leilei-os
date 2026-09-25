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
    @GestureState private var sidebarDragTranslation: CGFloat = 0

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
            let currentOffset = sidebarOffset(
                revealOffset: revealOffset
            )
            let revealProgress = max(
                0,
                min(currentOffset / revealOffset, 1)
            )
            let cardCornerRadius = 50 * revealProgress

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
                    color: .black.opacity(0.08 * revealProgress),
                    radius: 12 * revealProgress,
                    x: -2 * revealProgress,
                    y: 4 * revealProgress
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
                .offset(x: currentOffset)
                .simultaneousGesture(
                    sidebarDragGesture(
                        revealOffset: revealOffset
                    )
                )

            }
        }
        .ignoresSafeArea(.container)
    }

    private func sidebarOffset(
        revealOffset: CGFloat
    ) -> CGFloat {
        let baseOffset = menuOpen ? revealOffset : 0
        let rawOffset = baseOffset + sidebarDragTranslation

        if rawOffset < 0 {
            return -rubberBand(-rawOffset)
        }

        if rawOffset > revealOffset {
            return revealOffset
                + rubberBand(rawOffset - revealOffset)
        }

        return rawOffset
    }

    private func rubberBand(
        _ distance: CGFloat
    ) -> CGFloat {
        let constant: CGFloat = 72
        return constant * distance / (constant + distance)
    }

    private func sidebarDragGesture(
        revealOffset: CGFloat
    ) -> some Gesture {
        DragGesture(
            minimumDistance: 8,
            coordinateSpace: .local
        )
        .updating($sidebarDragTranslation) { value, state, _ in
            guard isSidebarDragEligible(value) else {
                state = 0
                return
            }

            state = value.translation.width
        }
        .onEnded { value in
            guard isSidebarDragEligible(value) else {
                return
            }

            let baseOffset = menuOpen ? revealOffset : 0
            let projectedOffset = baseOffset
                + value.predictedEndTranslation.width
            let shouldOpen =
                projectedOffset > revealOffset * 0.5

            withAnimation(.snappy) {
                menuOpen = shouldOpen
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
