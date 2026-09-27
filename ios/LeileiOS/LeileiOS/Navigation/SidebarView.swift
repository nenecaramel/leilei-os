import SwiftUI
import UIKit

struct SidebarView: View {
    @Binding var selectedPage: AppPage
    let menuButtonCenterY: CGFloat?
    let onNewSession: () -> Void
    let newSessionEnabled: Bool
    let conversations: [NativeLiveConversationSummary]
    let activeConversationID: UUID?
    let onOpenConversation: (NativeLiveConversationSummary) -> Void
    let onSettings: (() -> Void)?
    let onSelect: () -> Void
    private let topContentOffset: CGFloat = 18
    private let titleHorizontalOffset: CGFloat = -10
    private let navigationRowHorizontalInset: CGFloat = 12
    private let floatingControlDiameter: CGFloat = 44
    private let trailingFloatingControlCenterInset: CGFloat = 52

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        Text("Leilei OS")
                            .font(.system(size: 22, weight: .regular))
                            .padding(.top, 18)
                            .offset(x: titleHorizontalOffset - 5, y: 20)

                        VStack(alignment: .leading, spacing: 28) {
                            SidebarSection(
                                title: nil,
                                pages: [
                                    .projects,
                                    .diary,
                                    .daySpace,
                                    .universe
                                ],
                                selectedPage: $selectedPage,
                                textLeadingOffset: titleHorizontalOffset - navigationRowHorizontalInset,
                                selectedBackgroundLeadingOffset: titleHorizontalOffset - 16,
                                onSelect: onSelect
                            )
                            .offset(y: 9)

                            recentConversations
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .offset(y: 7)
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 92)
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
                    x: proxy.size.width
                        - trailingFloatingControlCenterInset,
                    y: localY(
                        menuButtonCenterY,
                        in: proxy,
                        fallback: 22
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
                .padding(.leading, 16)
                .padding(
                    .trailing,
                    trailingFloatingControlCenterInset
                        - floatingControlDiameter / 2
                )
                .padding(.bottom, 16)
            }
        }
    }


    private var recentConversations: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Recents")
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(.secondary.opacity(0.9))
                .padding(.horizontal, 10)
                .offset(x: titleHorizontalOffset - 14, y: 2)

            ForEach(Array(conversations.prefix(50))) { conversation in
                Button {
                    selectedPage = .chat
                    onSelect()
                    onOpenConversation(conversation)
                } label: {
                    HStack {
                        Text(displayTitle(for: conversation))
                            .font(.system(size: 17.5, weight: .regular))
                            .lineLimit(1)
                            .offset(
                                x: titleHorizontalOffset - navigationRowHorizontalInset,
                                y: 2
                            )

                        Spacer()
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 12)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: 44,
                        alignment: .leading
                    )
                    .contentShape(Rectangle())
                    .background {
                        if isActiveConversation(conversation) {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(.primary.opacity(0.05))
                                .padding(
                                    .leading,
                                    titleHorizontalOffset - 16
                                )
                                .padding(.trailing, 3)
                                .offset(y: 2)
                        }
                    }
                }
                .buttonStyle(.plain)
            }

            Button {
                selectedPage = .conversations
                onSelect()
            } label: {
                HStack(spacing: 6) {
                    Text("View all")
                        .font(.system(
                            size: 14.5,
                            weight: .medium
                        ))

                    Image(systemName: "chevron.right")
                        .font(.system(
                            size: 11,
                            weight: .semibold
                        ))

                    Spacer()
                }
                .foregroundStyle(
                    .secondary.opacity(0.9)
                )
                .padding(.horizontal, 10)
                .offset(
                    x: titleHorizontalOffset - 14,
                    y: 2
                )
                .frame(
                    maxWidth: .infinity,
                    minHeight: 36,
                    alignment: .leading
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func displayTitle(
        for conversation: NativeLiveConversationSummary
    ) -> String {
        let title = conversation.title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return title?.isEmpty == false ? title! : "New Conversation"
    }

    private func isActiveConversation(
        _ conversation: NativeLiveConversationSummary
    ) -> Bool {
        guard selectedPage == .chat,
              let activeConversationID,
              let conversationID = UUID(uuidString: conversation.id) else {
            return false
        }

        return activeConversationID == conversationID
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
        let symbolConfiguration = UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)
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
