import SwiftUI

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var appModel: AppModel

    @State private var selectedPage: AppPage = .chat
    @State private var menuOpen = false
    @State private var settingsPresented = false
    @State private var newSessionInFlight = false
    @State private var newSessionErrorMessage: String?
    @State private var floatingControlCenters: [String: CGFloat] = [:]

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
        .alert(
            "New conversation failed",
            isPresented: Binding(
                get: { newSessionErrorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        newSessionErrorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                newSessionErrorMessage = nil
            }
        } message: {
            Text(newSessionErrorMessage ?? "")
        }
    }


    private func createNewSession() {
        guard appModel.isAuthenticated, !newSessionInFlight else {
            return
        }

        newSessionInFlight = true

        Task { @MainActor in
            defer {
                newSessionInFlight = false
            }

            do {
                _ = try await appModel.createNativeLiveConversation(
                    title: "New Conversation"
                )
                selectedPage = .chat
            } catch {
                newSessionErrorMessage = error.localizedDescription
            }
        }
    }

    private func openConversationFromSidebar(
        _ conversation: NativeLiveConversationSummary
    ) {
        guard let conversationID = UUID(uuidString: conversation.id) else {
            return
        }

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
                        createNewSession()
                    },
                    newSessionEnabled:
                        appModel.isAuthenticated && !newSessionInFlight,
                    conversations: appModel.nativeLiveConversations,
                    activeConversationID: appModel.activeNativeLiveConversationID,
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
                .offset(x: menuOpen ? revealOffset : 0)

            }
        }
        .ignoresSafeArea()
    }

    private var iPadLayout: some View {
        HStack(spacing: 0) {
            SidebarView(
                selectedPage: $selectedPage,
                menuButtonCenterY: nil,
                onNewSession: {
                    createNewSession()
                },
                newSessionEnabled:
                    appModel.isAuthenticated && !newSessionInFlight,
                conversations: appModel.nativeLiveConversations,
                activeConversationID: appModel.activeNativeLiveConversationID,
                onOpenConversation: openConversationFromSidebar,
                onSettings: nil,
                onSelect: {}
            )
            .frame(width: 280)
            .background(Color(red: 0.98, green: 0.98, blue: 0.98))

            Divider()

            PageContainer(
                selectedPage: selectedPage,
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
    let onMenu: () -> Void
    let onOpenConversation: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            PageContainer(
                selectedPage: selectedPage,
                onMenu: onMenu,
                onOpenConversation: onOpenConversation
            )
        }
    }
}
