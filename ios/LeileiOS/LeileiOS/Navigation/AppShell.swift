import SwiftUI

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var appModel: AppModel

    @State private var selectedPage: AppPage = .chat
    @State private var menuOpen = false
    @State private var settingsPresented = false
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
            SettingsSheetView(
                isPresented: settingsPresented,
                onDismiss: {
                    settingsPresented = false
                },
                appModel: appModel
            )
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
                    composerControlsCenterY: floatingControlCenters[FloatingControlCenter.composer],
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
                composerControlsCenterY: nil,
                onSettings: nil,
                onSelect: {}
            )
            .frame(width: 280)
            .background(Color(red: 0.98, green: 0.98, blue: 0.98))

            Divider()

            PageContainer(
                selectedPage: selectedPage,
                onMenu: nil
            )
        }
    }
}

private struct MainPageLayer: View {
    let selectedPage: AppPage
    let onMenu: () -> Void

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            PageContainer(
                selectedPage: selectedPage,
                onMenu: onMenu
            )
        }
    }
}
