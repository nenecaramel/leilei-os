import SwiftUI

struct AppStateSurface: View {
    let title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Text(title)
        } actions: {
            if let actionTitle,
               let action {
                Button(actionTitle, action: action)
            }
        }
    }
}
