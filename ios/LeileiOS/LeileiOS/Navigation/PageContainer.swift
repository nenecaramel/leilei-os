import SwiftUI

struct PageContainer: View {
    @Binding var selectedPage: AppPage
    let onMenu: (() -> Void)?

    var body: some View {
        NavigationStack {
            Group {
                if selectedPage == .chat {
                    ChatView()
                } else if selectedPage == .system {
                    SystemPage(selectedPage: $selectedPage)
                } else {
                    PlaceholderPage(page: selectedPage)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            MenuIconView()
                        }
                    }
                }

                if selectedPage == .chat {
                    ToolbarItem(placement: .principal) {
                        Text("Claude")
                            .font(.headline)
                    }
                } else {
                    ToolbarItem(placement: .principal) {
                        Text(selectedPage.rawValue)
                            .font(.headline)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    if selectedPage == .chat {
                        Button {
                            // Chat more menu
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 18, weight: .medium))
                        }
                    } else {
                        Button {
                            // Search
                        } label: {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 18, weight: .medium))
                        }
                    }
                }
            }
            .toolbarBackground(
                selectedPage == .chat ? .hidden : .visible,
                for: .navigationBar
            )
            .toolbarBackground(
                selectedPage == .chat
                ? Color(.systemBackground)
                : Color(.secondarySystemBackground),
                for: .navigationBar
            )
            .background {
                if selectedPage == .chat {
                    Color(.systemBackground)
                        .ignoresSafeArea()
                }
            }
        }
    }
}
