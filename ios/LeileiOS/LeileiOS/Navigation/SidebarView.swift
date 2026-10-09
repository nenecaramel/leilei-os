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
    let onSettings: () -> Void
    let onSelect: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topTrailing) {
                ScrollView {
                    VStack(alignment: .leading, spacing: SidebarLayout.sectionSpacing) {
                        Text("Leilei OS")
                            .font(.system(size: 22, weight: .regular))
                            .padding(.top, SidebarLayout.titleTopInset)
                            .offset(SidebarLayout.titlePaintOffset)

                        VStack(alignment: .leading, spacing: SidebarLayout.sectionSpacing) {
                            SidebarSection(
                                title: nil,
                                pages: [
                                    .diary,
                                    .mind,
                                    .daySpace,
                                    .universe
                                ],
                                selectedPage: $selectedPage,
                                onSelect: onSelect
                            )
                            .offset(y: SidebarLayout.navigationPaintOffsetY)

                            recentConversations
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .offset(y: SidebarLayout.sectionsPaintOffsetY)
                    }
                    .padding(.horizontal, SidebarLayout.contentHorizontalInset)
                    .padding(.bottom, SidebarLayout.scrollBottomClearance)
                }
                .padding(.top, SidebarLayout.scrollTopInset)

                FloatingGlassButton(
                    symbol: "magnifyingglass",
                    accessibilityLabel: "Global Search"
                ) {
                    selectedPage = .globalSearch
                    onSelect()
                }
                .position(
                    x: proxy.size.width
                        - SidebarLayout.trailingFloatingControlCenterInset,
                    y: localY(
                        menuButtonCenterY,
                        in: proxy,
                        fallback: SidebarLayout.searchFallbackCenterY
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
                        onSettings()
                    }
                }
                .padding(.leading, SidebarLayout.footerLeadingInset)
                .padding(.trailing, SidebarLayout.footerTrailingInset)
                .padding(.bottom, SidebarLayout.footerBottomInset)
            }
        }
    }

    private var recentConversations: some View {
        VStack(alignment: .leading, spacing: SidebarLayout.rowSpacing) {
            Text("Recents")
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(.secondary.opacity(0.9))
                .padding(.horizontal, SidebarLayout.sectionLabelHorizontalInset)
                .offset(SidebarLayout.recentLabelPaintOffset)

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
                            .offset(SidebarLayout.rowTextPaintOffset)

                        Spacer()
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, SidebarLayout.rowHorizontalInset)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: SidebarLayout.rowMinimumHeight,
                        alignment: .leading
                    )
                    .contentShape(Rectangle())
                    .background {
                        if isActiveConversation(conversation) {
                            SidebarSelectionBackground()
                        }
                    }
                }
                .buttonStyle(.plain)
            }

            Button {
                selectedPage = .conversations
                onSelect()
            } label: {
                HStack(spacing: SidebarLayout.rowSpacing) {
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
                .padding(.horizontal, SidebarLayout.sectionLabelHorizontalInset)
                .offset(SidebarLayout.recentLabelPaintOffset)
                .frame(
                    maxWidth: .infinity,
                    minHeight: SidebarLayout.viewAllMinimumHeight,
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
        .frame(width: SidebarLayout.floatingControlDiameter, height: SidebarLayout.floatingControlDiameter)
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
