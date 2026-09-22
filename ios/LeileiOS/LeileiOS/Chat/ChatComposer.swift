import SwiftUI

struct ChatComposer: View {
    @Binding var text: String
    @Binding var model: String
    @Binding var effort: String
    var isFocused: FocusState<Bool>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(
                "",
                text: $text,
                prompt: Text("Chat with Claude")
                    .foregroundStyle(Color.primary.opacity(0.64)),
                axis: .vertical
            )
            .focused(isFocused)
            .font(.system(size: 17.5, weight: .medium))
            .foregroundStyle(Color.primary.opacity(0.68))
            .lineLimit(1...6)

            HStack(spacing: 8) {
                Menu {
                    Button {
                    } label: {
                        Label("Photo", systemImage: "photo")
                    }

                    Button {
                    } label: {
                        Label("Camera", systemImage: "camera")
                    }

                    Button {
                    } label: {
                        Label("File", systemImage: "doc")
                    }
                } label: {
                    ComposerCircleButton(
                        systemName: "plus"
                    )
                }

                Menu {
                    Section("Model") {
                        Button("Opus 5") {
                            model = "Opus 5"
                        }

                        Button("Sonnet 5") {
                            model = "Sonnet 5"
                        }

                        Button("Default") {
                            model = "Default"
                        }
                    }

                    Section("Thinking") {
                        Button("Low") {
                            effort = "Low"
                        }

                        Button("Medium") {
                            effort = "Medium"
                        }

                        Button("High") {
                            effort = "High"
                        }
                    }
                } label: {
                    CombinedModelCapsule(
                        model: model,
                        effort: effort
                    )
                }

                Spacer(minLength: 0)

                Button {
                } label: {
                    ComposerCircleButton(
                        systemName: "mic.fill"
                    )
                }
                .buttonStyle(.plain)

                Button {
                    if text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty {
                    } else {
                        text = ""
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(.black)
                            .frame(width: 36, height: 36)

                        Image(
                            systemName:
                                text.trimmingCharacters(
                                    in: .whitespacesAndNewlines
                                ).isEmpty
                                ? "waveform"
                                : "arrow.up"
                        )
                        .font(.system(
                            size: 15,
                            weight: .semibold
                        ))
                        .foregroundStyle(.white)
                    }
                }
                .buttonStyle(.plain)
            }
            .reportingFloatingControlCenter(FloatingControlCenter.composer)
        }
        .padding(.horizontal, 16)
        .padding(.top, 15)
        .padding(.bottom, 12)
        .glassEffect(
            .regular,
            in: RoundedRectangle(
                cornerRadius: 30,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: 30,
                style: .continuous
            )
            .stroke(Color.primary.opacity(0.08), lineWidth: 0.6)
        }
    }
}
