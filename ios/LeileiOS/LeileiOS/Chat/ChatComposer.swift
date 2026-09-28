import SwiftUI

struct ChatComposer: View {
    @Binding var text: String
    @Binding var model: NativeLiveClaudeModel
    @Binding var thinking: NativeLiveThinkingMode
    @Binding var effort: NativeLiveEffortLevel
    var isFocused: FocusState<Bool>.Binding
    var isSending = false
    var isRuntimeTurnActive = false
    var isRuntimeControlInFlight = false
    var interruptRequested = false
    var isEditing = false
    var onCancelEdit: (() -> Void)? = nil
    var onInterrupt: (() -> Void)? = nil
    var onMidTurnInput: ((String) -> Void)? = nil
    var onSend: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if isEditing {
                HStack(spacing: 8) {
                    Text("Edit message")
                        .font(.system(size: 13.5, weight: .regular))
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 0)

                    Button {
                        onCancelEdit?()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .light))
                            .foregroundStyle(.secondary)
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel edit")
                }
                .padding(.leading, 12)
                .padding(.trailing, 6)
                .frame(height: 34)
                .background(
                    Color.chatSoftFill,
                    in: RoundedRectangle(
                        cornerRadius: 12,
                        style: .continuous
                    )
                )
                .transition(.opacity)
            }

            TextField(
                "",
                text: $text,
                prompt: Text("Write a message...")
                    .foregroundStyle(Color.primary.opacity(0.64)),
                axis: .vertical
            )
            .focused(isFocused)
            .font(.system(size: 17.5, weight: .regular))
            .foregroundStyle(.primary)
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
                        systemName: "plus",
                        weight: .light
                    )
                }

                Menu {
                    Section("Model") {
                        Picker("", selection: modelSelection) {
                            ForEach(
                                Array(NativeLiveClaudeModel.allCases.reversed())
                            ) { option in
                                Text(option.displayName)
                                    .tag(option)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    }

                    Section("Effort") {
                        Picker("", selection: $effort) {
                            ForEach(availableEffortLevels) { option in
                                Text(option.displayName)
                                    .tag(option)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.inline)
                    }

                    Section("Thinking") {
                        Picker("", selection: thinkingSelection) {
                            ForEach(
                                Array(model.supportedThinkingModes.reversed())
                            ) { option in
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
                    let normalized = text.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    )

                    if isRuntimeTurnActive {
                        guard !isRuntimeControlInFlight else {
                            return
                        }

                        if normalized.isEmpty {
                            guard !interruptRequested else {
                                return
                            }
                            onInterrupt?()
                        } else {
                            onMidTurnInput?(normalized)
                        }
                        return
                    }

                    guard !normalized.isEmpty,
                          !isSending else {
                        return
                    }
                    onSend?()
                } label: {
                    ZStack {
                        Circle()
                            .fill(.black)
                            .frame(width: 36, height: 36)

                        if isRuntimeTurnActive,
                           interruptRequested,
                           text.trimmingCharacters(
                               in: .whitespacesAndNewlines
                           ).isEmpty {
                            ProgressView()
                                .controlSize(.small)
                                .tint(.white)
                        } else {
                            Image(
                                systemName:
                                    composerActionSymbol
                            )
                            .font(.system(
                                size: 15,
                                weight:
                                    composerActionWeight
                            ))
                            .foregroundStyle(.white)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(
                    isRuntimeControlInFlight
                        || (
                            isSending
                            && !isRuntimeTurnActive
                        )
                )
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

    private var composerActionSymbol: String {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        if isRuntimeTurnActive {
            return normalized.isEmpty
                ? "square.fill"
                : "arrow.up"
        }

        return normalized.isEmpty
            ? "waveform"
            : "arrow.up"
    }

    private var composerActionWeight: Font.Weight {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )

        if isRuntimeTurnActive,
           normalized.isEmpty {
            return .regular
        }

        return normalized.isEmpty
            ? .semibold
            : .regular
    }

    private func selectModel(
        _ selection: NativeLiveClaudeModel
    ) {
        model = selection

        if !selection.supportedThinkingModes.contains(thinking) {
            thinking = selection.supportedThinkingModes[0]
        }

        let allowedEfforts = selection.supportedEffortLevels(
            thinking: thinking
        )
        if !allowedEfforts.contains(effort) {
            effort = allowedEfforts.contains(.high)
                ? .high
                : allowedEfforts[0]
        }
    }

    private var availableEffortLevels: [NativeLiveEffortLevel] {
        model.supportedEffortLevels(thinking: thinking)
    }

    private var modelSelection: Binding<NativeLiveClaudeModel> {
        Binding(
            get: { model },
            set: { selectModel($0) }
        )
    }

    private var thinkingSelection: Binding<NativeLiveThinkingMode> {
        Binding(
            get: { thinking },
            set: { selection in
                thinking = selection

                let allowedEfforts = model.supportedEffortLevels(
                    thinking: selection
                )
                if !allowedEfforts.contains(effort) {
                    effort = allowedEfforts.contains(.high)
                        ? .high
                        : allowedEfforts[0]
                }
            }
        )
    }
}
