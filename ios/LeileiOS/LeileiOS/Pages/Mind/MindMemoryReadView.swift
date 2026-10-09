import SwiftUI

struct MindMemoryReadView: View {
    @EnvironmentObject private var appModel: AppModel
    let id: String
    let onChanged: () -> Void

    @State private var item: MindProductItem?
    @State private var failed = false
    @State private var retryToken = UUID()

    var body: some View {
        Group {
            if let item {
                MindItemDetailView(initialItem: item, onDeleted: onChanged)
            } else if failed {
                AppStateSurface(title: "Unavailable", actionTitle: "Retry") {
                    retryToken = UUID()
                }
            } else {
                ProgressView()
            }
        }
        .task(id: retryToken) {
            do {
                let latest = try await appModel.api.mindItem(stateID: id)
                guard !Task.isCancelled else { return }
                item = latest
                failed = false
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}
