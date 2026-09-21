import SwiftUI

struct ChatComposer: View {
    @Binding var text: String
    @Binding var model: String
    @Binding var effort: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Chat with Claude", text: $text, axis: .vertical)
                .font(.system(size: 20, weight: .medium))
                .lineLimit(1...6)
                .padding(.top, 2)

            HStack(spacing: 10) {
                attachmentsMenu
                modelMenu

                Spacer(minLength: 0)

                Button {
                    // Voice input
                } label: {
                    ComposerCircleButton(systemName: "mic.fill")
                }
                .buttonStyle(.plain)

                Button {
                    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        // Future voice conversation / call
                    } else {
                        // Future send action
                        text = ""
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(.primary)
                            .frame(width: 46, height: 46)

                        Image(systemName: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "waveform" : "arrow.up")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Color(.systemBackground))
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 17)
        .padding(.bottom, 12)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .stroke(Color.primary.opacity(0.10), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.055), radius: 18, y: 7)
    }

    private var attachmentsMenu: some View {
        Menu {
            Button { } label: { Label("Photo", systemImage: "photo") }
            Button { } label: { Label("Camera", systemImage: "camera") }
            Button { } label: { Label("File", systemImage: "doc") }
        } label: {
            ComposerCircleButton(systemName: "plus")
        }
    }

    private var modelMenu: some View {
        Menu {
            Section("Model") {
                Button("Opus 5") { model = "Opus 5" }
                Button("Sonnet 5") { model = "Sonnet 5" }
                Button("Default") { model = "Default" }
            }

            Section("Thinking") {
                Button("Low") { effort = "Low" }
                Button("Medium") { effort = "Medium" }
                Button("High") { effort = "High" }
            }
        } label: {
            CombinedModelCapsule(model: model, effort: effort)
        }
    }
}
