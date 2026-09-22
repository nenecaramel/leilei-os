import SwiftUI

struct ChatView: View {
    @State private var messageText = ""
    @State private var model = "Opus 5"
    @State private var effort = "High"
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            ScrollView {
                LazyVStack(spacing: 18) {
                    Color.clear
                        .frame(height: 1)
                }
                .padding(.horizontal, 16)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            isComposerFocused = false
        }
        .safeAreaInset(edge: .bottom) {
            ChatComposer(
                text: $messageText,
                model: $model,
                effort: $effort,
                isFocused: $isComposerFocused
            )
            .padding(.horizontal, 14)
            .padding(.top, 18)
            .padding(.bottom, 8)
            .background {
                LinearGradient(
                    colors: [
                        Color(.systemBackground).opacity(0),
                        Color(.systemBackground)
                    ],
                    startPoint: .top,
                    endPoint: .center
                )
                .ignoresSafeArea()
            }
        }
    }
}
