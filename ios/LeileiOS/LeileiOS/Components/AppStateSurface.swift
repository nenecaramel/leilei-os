import SwiftUI

struct AppStateSurface: View {
    let title: String
    let systemImage: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } actions: {
            if let actionTitle,
               let action {
                Button(actionTitle, action: action)
            }
        }
    }
}
