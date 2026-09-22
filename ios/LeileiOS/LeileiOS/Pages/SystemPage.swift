import SwiftUI

struct SystemPage: View {
    @Binding var selectedPage: AppPage

    private let pages: [AppPage] = [
        .account,
        .connections,
        .data,
        .activity,
        .about
    ]

    var body: some View {
        List(pages) { page in
            Button(page.rawValue) {
                selectedPage = page
            }
            .foregroundStyle(.primary)
        }
    }
}
