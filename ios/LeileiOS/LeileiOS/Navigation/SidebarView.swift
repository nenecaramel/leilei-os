import SwiftUI

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    let menuButtonCenterY: CGFloat?
    let onSettings: (() -> Void)?
    let onSelect: () -> Void
    private let topContentOffset: CGFloat = 18
    private let titleHorizontalOffset: CGFloat = -10
    private let navigationRowHorizontalInset: CGFloat = 12

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        Text("Leilei OS")
                            .font(.system(size: 22, weight: .semibold))
                            .padding(.top, 18)
                            .offset(x: titleHorizontalOffset, y: 16)

                        SidebarSection(
                            title: nil,
                            pages: [
                                .home,
                                .chat,
                                .memory,
                                .diary,
                                .task,
                                .daySpace,
                                .sharedPaper,
                                .conversations,
                                .universe,
                                .sentinel
                            ],
                            selectedPage: $selectedPage,
                            textLeadingOffset: titleHorizontalOffset - navigationRowHorizontalInset,
                            selectedBackgroundLeadingOffset: titleHorizontalOffset - 15,
                            onSelect: onSelect
                        )
                        .offset(y: 9)

                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 40)
                }
                .padding(.top, topContentOffset)

                FloatingGlassButton(
                    symbol: "magnifyingglass",
                    accessibilityLabel: "Global Search"
                ) {
                    selectedPage = .globalSearch
                    onSelect()
                }
                .position(
                    x: proxy.size.width - 40,
                    y: localY(
                        menuButtonCenterY,
                        in: proxy,
                        fallback: proxy.safeAreaInsets.top + 22
                    )
                )
            }
            .overlay(alignment: .bottomTrailing) {
                FloatingGlassButton(
                    symbol: "gearshape",
                    accessibilityLabel: "Settings"
                ) {
                    if let onSettings {
                        onSettings()
                    } else {
                        selectedPage = .account
                        onSelect()
                    }
                }
                .padding()
            }
        }
    }

    private func localY(
        _ globalY: CGFloat?,
        in proxy: GeometryProxy,
        fallback: CGFloat
    ) -> CGFloat {
        guard let globalY else { return fallback }
        return globalY - proxy.frame(in: .global).minY
    }
}

struct FloatingGlassButton: View {
    let symbol: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .buttonSizing(.fitted)
        .accessibilityLabel(accessibilityLabel)
    }
}
