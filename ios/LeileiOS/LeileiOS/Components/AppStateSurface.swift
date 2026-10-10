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
    let cancelTitle: String
    let actionRole: ButtonRole?
    @Binding var isPresented: Bool
    let onConfirm: () -> Void

    func body(content: Content) -> some View {
        content.alert(
            title,
            isPresented: $isPresented
        ) {
            Button(cancelTitle, role: .cancel) {
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
    func appFailureAlert(
        message: String,
        isPresented: Binding<Bool>
    ) -> some View {
        self.alert("Failed", isPresented: isPresented) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message)
        }
    }

    func appConfirmationAlert(
        title: String,
        message: String,
        actionTitle: String,
        actionRole: ButtonRole? = nil,
        cancelTitle: String = "Cancel",
        isPresented: Binding<Bool>,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(
            AppConfirmationAlertModifier(
                title: title,
                message: message,
                actionTitle: actionTitle,
                cancelTitle: cancelTitle,
                actionRole: actionRole,
                isPresented: isPresented,
                onConfirm: onConfirm
            )
        )
    }
}
