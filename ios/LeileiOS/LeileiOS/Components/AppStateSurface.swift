import SwiftUI

struct AppStateSurface: View {
    let title: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Text(title)
                .font(.body)
                .fontWeight(.regular)
                .foregroundStyle(.secondary)
        } actions: {
            if let actionTitle,
               let action {
                Button(actionTitle, action: action)
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity,
            alignment: .center
        )
    }
}


private struct AppConfirmationAlertModifier: ViewModifier {
    let title: String
    let message: String
    let actionTitle: String
    let actionRole: ButtonRole?
    @Binding var isPresented: Bool
    let onConfirm: () -> Void

    func body(content: Content) -> some View {
        content.alert(
            title,
            isPresented: $isPresented
        ) {
            Button("Cancel", role: .cancel) {
            }

            Button(actionTitle, role: actionRole) {
                onConfirm()
            }
        } message: {
            Text(message)
        }
    }
}

extension View {
    func appConfirmationAlert(
        title: String,
        message: String,
        actionTitle: String,
        actionRole: ButtonRole? = nil,
        isPresented: Binding<Bool>,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(
            AppConfirmationAlertModifier(
                title: title,
                message: message,
                actionTitle: actionTitle,
                actionRole: actionRole,
                isPresented: isPresented,
                onConfirm: onConfirm
            )
        )
    }
}
