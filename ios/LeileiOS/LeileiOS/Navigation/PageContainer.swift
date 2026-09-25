import SwiftUI

struct PageContainer: View {
    @EnvironmentObject private var appModel: AppModel

    let selectedPage: AppPage
    let onMenu: (() -> Void)?
    let onOpenConversation: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if selectedPage == .chat {
                    ChatView()
                } else if selectedPage == .globalSearch {
                    GlobalSearchView()
                } else if selectedPage == .diary {
                    DiaryView()
                } else if selectedPage == .daySpace {
                    DaySpaceView()
                } else if selectedPage == .conversations {
                    ConversationsView(
                        onOpenConversation: onOpenConversation
                    )
                } else {
                    PlaceholderPage(page: selectedPage)
                }
            }
            .navigationTitle(pageTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            CompactMenuIcon()
                        }
                        .reportingFloatingControlCenter(FloatingControlCenter.menu)
                    }
                }

                if selectedPage != .globalSearch
                    && selectedPage != .diary
                    && selectedPage != .daySpace
                    && selectedPage != .conversations {
                    ToolbarItem(placement: .topBarTrailing) {
                        if selectedPage == .chat {
                            Menu {
                                Button {
                                    // Rename is intentionally not faked locally.
                                    // Wire this action when native/live exposes
                                    // a durable conversation-title mutation.
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }

                                Button(role: .destructive) {
                                    // Delete is a UI placeholder until native/live
                                    // conversation deletion exists.
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 18, weight: .medium))
                            }
                            .accessibilityLabel("Conversation menu")
                        } else {
                            Button {
                            } label: {
                                Image(systemName: "magnifyingglass")
                                    .font(.system(size: 18, weight: .medium))
                            }
                        }
                    }
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
        }
        .background(Color(.systemBackground).ignoresSafeArea())
    }

    private var pageTitle: String {
        guard selectedPage == .chat else {
            return selectedPage.rawValue
        }
        return activeConversationTitle
    }

    private var activeConversationTitle: String {
        if let activeConversationID = appModel.activeNativeLiveConversationID,
           let conversation = appModel.nativeLiveConversations.first(where: {
               guard let id = UUID(uuidString: $0.id) else { return false }
               return id == activeConversationID
           }),
           let title = normalizedTitle(conversation.title) {
            return title
        }

        if let title = normalizedTitle(appModel.nativeLiveCurrentPath?.title) {
            return title
        }

        return "New Conversation"
    }

    private func normalizedTitle(_ title: String?) -> String? {
        guard let title else { return nil }
        let normalized = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }
}


private struct CompactMenuIcon: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            line(width: 17)
            line(width: 17)
            line(width: 10)
        }
        .frame(width: 17, height: 14, alignment: .leading)
        .accessibilityLabel("Menu")
    }

    private func line(width: CGFloat) -> some View {
        Capsule()
            .fill(Color.primary)
            .frame(width: width, height: 2)
    }
}
