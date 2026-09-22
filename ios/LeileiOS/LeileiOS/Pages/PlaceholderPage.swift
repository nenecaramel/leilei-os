import SwiftUI

struct PlaceholderPage: View {
    let page: AppPage

    var body: some View {
        VStack(spacing: 14) {
            Text(page.rawValue)
                .font(.largeTitle.bold())

            Text("LeileiOS iOS")
                .foregroundStyle(.secondary)
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(
            Color(.systemBackground)
        )
    }
}
