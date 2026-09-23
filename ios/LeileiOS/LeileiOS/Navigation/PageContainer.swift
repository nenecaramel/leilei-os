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
                } else if selectedPage == .diary {
                    DiaryView()
                } else {
                    PlaceholderPage(page: selectedPage)
                }
            }
            .navigationTitle(selectedPage == .chat ? "Claude" : selectedPage.rawValue)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if let onMenu {
                        Button(action: onMenu) {
                            Image(systemName: "line.3.horizontal")
                                .font(.system(size: 17, weight: .medium))
                                .accessibilityLabel("Menu")
                        }
                        .reportingFloatingControlCenter(FloatingControlCenter.menu)
                    }
                }


                if selectedPage != .globalSearch && selectedPage != .diary {
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
