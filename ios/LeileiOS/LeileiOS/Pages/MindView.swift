import SwiftUI

struct MindView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var addPresented = false
    @State private var refreshToken = UUID()

    var body: some View {
        MindMemoryListView()
            .id(refreshToken)
            .toolbar {
                if #available(iOS 26.0, *) {
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        createMemoryButton
                    }
                } else {
                    ToolbarItem(placement: .topBarTrailing) {
                        createMemoryButton
                    }
                }
            }
            .sheet(isPresented: $addPresented, onDismiss: {
                refreshToken = UUID()
            }) {
                MindManualEntrySheet()
                    .environmentObject(appModel)
            }
    }

    private var createMemoryButton: some View {
        Button {
            addPresented = true
        } label: {
            Image(systemName: "square.and.pencil")
        }
        .accessibilityLabel("New Memory")
    }
}
