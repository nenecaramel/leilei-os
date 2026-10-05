import SwiftUI

struct ComposerStatusArea: View {
    let voiceStatus: String?
    let isEditing: Bool
    let onCancelEdit: (() -> Void)?

    @ViewBuilder var body: some View {
        if let voiceStatus {
            Text(voiceStatus).font(.footnote).foregroundStyle(.secondary)
        }
        if isEditing {
            ComposerEditBanner(onCancelEdit: onCancelEdit)
        }
    }
}

struct ComposerEditBanner: View {
    let onCancelEdit: (() -> Void)?

    var body: some View {
        HStack(spacing: ChatPresentationLayout.composerRowSpacing) {
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
                cornerRadius: LeileiUI.Radius.card,
                style: .continuous
            )
        )
        .transition(.opacity)
    }
}

struct ComposerAttachmentMenu: View {
    let onPickPhoto: (() -> Void)?
    let onTakePhoto: (() -> Void)?
    let onPickFile: (() -> Void)?

    var body: some View {
        Menu {
            Button {
                onPickPhoto?()
            } label: {
                Label("Photo", systemImage: "photo")
            }

            Button {
                onTakePhoto?()
            } label: {
                Label("Camera", systemImage: "camera")
            }

            Button {
                onPickFile?()
            } label: {
                Label("File", systemImage: "doc")
            }

        } label: {
            ComposerCircleButton(
                systemName: "plus",
                weight: .light
            )
        }
    }
}

struct ComposerModelMenu: View {
    let model: NativeLiveClaudeModel
    @Binding var effort: NativeLiveEffortLevel
    let modelSelection: Binding<NativeLiveClaudeModel>
    let thinkingSelection: Binding<NativeLiveThinkingMode>
    let modelOptions: [NativeLiveClaudeModel]
    let availableEffortLevels: [NativeLiveEffortLevel]
    let thinkingOptions: [NativeLiveThinkingMode]

    var body: some View {
        Menu {
            Section("Model") {
                Picker("", selection: modelSelection) {
                    ForEach(
                        modelOptions
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
                        thinkingOptions
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
    }
}

struct ComposerPrimaryActionLabel: View {
    let presentation: ComposerPrimaryActionPresentation

    var body: some View {
        ZStack {
            Circle()
                .fill(.black)
                .frame(width: LeileiUI.ControlGeometry.compact, height: LeileiUI.ControlGeometry.compact)

            if presentation.mode == .interruptPending {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
            } else {
                Image(systemName: presentation.symbol)
                    .font(LeileiUI.Typography.controlGlyph(weight: presentation.weight))
                    .foregroundStyle(.white)
            }
        }
    }
}

struct NativeLiveComposerTextInput: View, Equatable {
    @Binding var text: String
    let textSnapshot: String
    var isFocused: FocusState<Bool>.Binding
    let focusSnapshot: Bool

    static func == (
        lhs: NativeLiveComposerTextInput,
        rhs: NativeLiveComposerTextInput
    ) -> Bool {
        lhs.textSnapshot == rhs.textSnapshot
            && lhs.focusSnapshot == rhs.focusSnapshot
    }

    var body: some View {
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
    }
}


struct ComposerPrimaryActionButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    let isVisuallyDimmed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(
                isVisuallyDimmed
                    ? 0.35
                    : (
                        configuration.isPressed
                        && isEnabled
                            ? 0.72
                            : 1
                    )
            )
    }
}
