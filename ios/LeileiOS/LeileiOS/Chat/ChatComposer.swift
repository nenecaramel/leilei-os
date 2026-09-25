import SwiftUI

struct ChatComposer: View {
    @Binding var text: String
    @Binding var model: NativeLiveClaudeModel
    @Binding var thinking: NativeLiveThinkingMode
    @Binding var effort: NativeLiveEffortLevel
    var isFocused: FocusState<Bool>.Binding
    var isSending = false
    var onSend: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            TextField(
                "",
                text: $text,
                prompt: Text("Write a message...")
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
                        Picker("", selection: modelSelection) {
                            ForEach(NativeLiveClaudeModel.allCases) { option in
                                Text(option.displayName)
                                    .tag(option)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    }

                    Section("Thinking") {
                        Picker("", selection: $thinking) {
                            ForEach(model.supportedThinkingModes) { option in
                                Text(option.displayName)
                                    .tag(option)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    }

                    Section("Effort") {
                        Picker("", selection: $effort) {
                            ForEach(model.supportedEffortLevels) { option in
                                Text(option.displayName)
                                    .tag(option)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    }
                } label: {
                    CombinedModelCapsule(
                        model: model.displayName,
                        effort: effort.displayName
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
                    guard !text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty,
                    !isSending else {
                        return
                    }
                    onSend?()
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
                .disabled(isSending)
            }
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

    private func selectModel(
        _ selection: NativeLiveClaudeModel
    ) {
        model = selection

        if !selection.supportedThinkingModes.contains(thinking) {
            thinking = selection.supportedThinkingModes[0]
        }

        if !selection.supportedEffortLevels.contains(effort) {
            effort = selection.supportedEffortLevels.contains(.high)
                ? .high
                : selection.supportedEffortLevels[0]
        }
    }

    private var modelSelection: Binding<NativeLiveClaudeModel> {
        Binding(
            get: { model },
            set: { selectModel($0) }
        )
    }
}
