import SwiftUI
import UIKit

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    let menuButtonCenterY: CGFloat?
    let onNewSession: () -> Void
    let newSessionEnabled: Bool
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
                            .font(.system(size: 22, weight: .semibold, design: .rounded))
                            .padding(.top, 18)
                            .offset(x: titleHorizontalOffset, y: 18)

                        SidebarSection(
                            title: nil,
                            pages: [
                                .home,
                                .chat,
                                .diary,
                                .daySpace,
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
            .overlay(alignment: .bottom) {
                HStack {
                    FloatingGlassButton(
                        symbol: "square.and.pencil",
                        accessibilityLabel: "New Session",
                        action: onNewSession
                    )
                    .disabled(!newSessionEnabled)

                    Spacer()

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
        FloatingUIKitGlassButton(
            symbol: symbol,
            accessibilityLabel: accessibilityLabel,
            action: action
        )
        .frame(width: 44, height: 44)
    }
}

private struct FloatingUIKitGlassButton: UIViewRepresentable {
    let symbol: String
    let accessibilityLabel: String
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UIButton {
        let button = UIButton(type: .system)
        let symbolConfiguration = UIImage.SymbolConfiguration(pointSize: 17, weight: .medium)
        var configuration = UIButton.Configuration.glass()
        configuration.image = UIImage(systemName: symbol)
        configuration.contentInsets = .zero
        configuration.cornerStyle = .capsule
        configuration.preferredSymbolConfigurationForImage = symbolConfiguration
        button.configuration = configuration
        button.accessibilityLabel = accessibilityLabel
        button.addAction(UIAction { _ in
            context.coordinator.parent.action()
        }, for: .touchUpInside)
        return button
    }

    func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.parent = self
        button.accessibilityLabel = accessibilityLabel
    }

    final class Coordinator {
        var parent: FloatingUIKitGlassButton

        init(_ parent: FloatingUIKitGlassButton) {
            self.parent = parent
        }
    }
}
