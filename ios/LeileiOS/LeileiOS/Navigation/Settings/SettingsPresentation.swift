import SwiftUI

extension Color {
    static let settingsBackground = Color(
        red: 0.965,
        green: 0.965,
        blue: 0.97
    )
}

struct SettingsSectionState: View {
    let title: String
    var actionTitle: String? = nil
    var isLoading = false
    var action: (() -> Void)? = nil

    var body: some View {
        HStack {
            Text(title)
                .font(.body)
                .foregroundStyle(.secondary)

            Spacer()

            if isLoading {
                ProgressView()
                    .controlSize(.small)
            }

            if let actionTitle,
               let action {
                Button(actionTitle, action: action)
            }
        }
        .frame(
            maxWidth: .infinity,
            minHeight: 44,
            alignment: .leading
        )
    }
}
