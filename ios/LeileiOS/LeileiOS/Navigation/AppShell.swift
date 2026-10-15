import SwiftUI
import UIKit

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var inheritedColorScheme
    @EnvironmentObject private var appModel: AppModel

    // The iPhone shell is the final backdrop exposed by the system keyboard's
    // rounded top corners, outside PageContainer's clipped navigation card.
    @AppStorage(ChatTheme.storageKey) private var chatThemeRawValue =
        ChatTheme.original.rawValue
    @AppStorage(IMessageWallpaper.revisionKey) private var wallpaperRevision = ""
    @State private var shellWallpaperImage: UIImage?

    @State private var selectedPage: AppPage = .chat
    @State private var diaryTarget: DiaryNavigationTarget?
    @State private var daySpaceTarget: DaySpaceNavigationTarget?
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
                    .background { rootWallpaperBackdrop }
            } else {
                iPhoneLayout
            }
        }
        .environment(\.iMessageWallpaperVisible, isWallpaperChatVisible)
        .environment(\.colorScheme, shellColorScheme)
        .tint(.primary)
        .task(id: wallpaperRevision) {
            shellWallpaperImage = IMessageWallpaper.load()
        }
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

    // Exactly one physical renderer. iPhone places it in the previously
    // verified ZStack background beneath the navigation card (and keyboard);
    // iPad uses the same view behind its split layout.
    @ViewBuilder
    private var rootWallpaperBackdrop: some View {
        if isWallpaperChatVisible, let shellWallpaperImage {
            GeometryReader { geometry in
                Image(uiImage: shellWallpaperImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
            }
            .ignoresSafeArea(.all)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
        }
    }

    private var isWallpaperChatVisible: Bool {
        selectedPage == .chat
            && chatThemeRawValue == ChatTheme.iMessage.rawValue
            && shellWallpaperImage != nil
            && !menuOpen
            && sidebarDragTranslation == 0
    }

    private var isUniverseTheme: Bool {
        selectedPage == .universe
    }

    private var shellColorScheme: ColorScheme {
        isUniverseTheme ? .dark : inheritedColorScheme
    }

    private var universeBackground: Color {
        UniversePalette.background
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

    // Device chrome owns reveal geometry and the Sidebar backdrop. The
    // PageContainer owns the main page/navigation background on both devices.
    private var iPhoneLayout: some View {
        GeometryReader { proxy in
            let revealOffset = min(proxy.size.width * 0.77, 330)
            let cardCornerRadius: CGFloat = menuOpen ? 50 : 0

            ZStack(alignment: .leading) {
                // The sidebar stays painted behind the chat, but must never
                // appear through its transparent iMessage message surface.
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

                // One fixed wallpaper ABOVE sidebar text and BELOW the chat.
                // Its placement stays at the outer iPhone shell so the
                // keyboard does not change the image crop or reveal white.
                if isWallpaperChatVisible {
                    rootWallpaperBackdrop
                }

                PageContainer(
                    selectedPage: selectedPage,
                    diaryTarget: diaryTarget,
                    daySpaceTarget: daySpaceTarget,
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
                    onOpenDiary: { target in
                        diaryTarget = target
                        selectedPage = .diary
                    },
                    onDiaryTargetConsumed: {
                        diaryTarget = nil
                    },
                    onOpenDaySpace: { target in
                        daySpaceTarget = target
                        selectedPage = .daySpace
                    },
                    onDaySpaceTargetConsumed: {
                        daySpaceTarget = nil
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
                onSettings: {
                    settingsPresented = true
                },
                onSelect: {}
            )
            .frame(width: 280)
            .background(sidebarBackground)

            Divider()

            PageContainer(
                selectedPage: selectedPage,
                diaryTarget: diaryTarget,
                daySpaceTarget: daySpaceTarget,
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
                onOpenDiary: { target in
                    diaryTarget = target
                    selectedPage = .diary
                },
                onDiaryTargetConsumed: {
                    diaryTarget = nil
                },
                onOpenDaySpace: { target in
                    daySpaceTarget = target
                    selectedPage = .daySpace
                },
                onDaySpaceTargetConsumed: {
                    daySpaceTarget = nil
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
