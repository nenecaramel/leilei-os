import SwiftUI

struct MindView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var addPresented = false

    var body: some View {
        MindMemoryListView()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        addPresented = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Add Memory")
                }
            }
            .sheet(isPresented: $addPresented) {
                MindManualEntrySheet()
                    .environmentObject(appModel)
            }
    }
}
