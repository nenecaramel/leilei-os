import SwiftUI

struct AppShell: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var selectedPage: AppPage = .chat
    @State private var menuOpen = false

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                iPadLayout
            } else {
                iPhoneLayout
            }
        }
        .tint(.primary)
    }

    private var iPhoneLayout: some View {
        ZStack(alignment: .leading) {
            SidebarView(
                selectedPage: $selectedPage,
                onSelect: closeMenu
            )
            .frame(width: 285)
            .background(.regularMaterial)

            PageContainer(
                selectedPage: $selectedPage,
                onMenu: {
                    withAnimation(.snappy) {
                        menuOpen.toggle()
                    }
                }
            )
            .offset(x: menuOpen ? 285 : 0)
            .overlay {
                if menuOpen {
                    Color.black.opacity(0.08)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            closeMenu()
                        }
                }
            }
            .clipShape(
                RoundedRectangle(
                    cornerRadius: menuOpen ? 20 : 0,
                    style: .continuous
                )
            )
            .shadow(
                color: .black.opacity(menuOpen ? 0.18 : 0),
                radius: 18,
                x: -3,
                y: 0
            )
        }
        .animation(.snappy, value: menuOpen)
    }

    private var iPadLayout: some View {
        HStack(spacing: 0) {
            SidebarView(
                selectedPage: $selectedPage,
                onSelect: {}
            )
            .frame(width: 280)
            .background(.regularMaterial)

            Divider()

            PageContainer(
                selectedPage: $selectedPage,
                onMenu: nil
            )
        }
    }

    private func closeMenu() {
        withAnimation(.snappy) {
            menuOpen = false
        }
    }
}
