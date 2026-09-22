import SwiftUI

struct PageContainer: View {
    let selectedPage: AppPage
    let onMenu: (() -> Void)?

    var body: some View {
        NavigationStack {
            Group {
                if selectedPage == .chat {
                    ChatView()
                } else if selectedPage == .globalSearch {
                    GlobalSearchView()
                } else {
                    PlaceholderPage(page: selectedPage)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            CompactMenuIcon()
                        }
                        .reportingFloatingControlCenter(FloatingControlCenter.menu)
                    }
                }

                if selectedPage == .chat {
                    ToolbarItem(placement: .principal) {
                        Text("Claude")
                            .font(.system(size: 18, weight: .semibold))
                    }
                } else {
                    ToolbarItem(placement: .principal) {
                        Text(selectedPage.rawValue)
                            .font(.system(size: 18, weight: .semibold))
                    }
                }

                if selectedPage != .globalSearch {
                    ToolbarItem(placement: .topBarTrailing) {
                        if selectedPage == .chat {
                            Button {
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 18, weight: .medium))
                            }
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
