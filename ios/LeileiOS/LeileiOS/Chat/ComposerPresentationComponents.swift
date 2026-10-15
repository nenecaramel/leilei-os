import SwiftUI

struct ComposerStatusArea: View {
    let voiceStatus: String?
    let isEditing: Bool
    let onCancelEdit: (() -> Void)?
    var isIMessage = false
    var voicePhase: VoiceInputController.Phase = .idle

    @ViewBuilder var body: some View {
        if let voiceStatus {
            if isIMessage {
                IMessageVoiceStatusView(status: voiceStatus, phase: voicePhase)
            } else {
                Text(voiceStatus).font(.footnote).foregroundStyle(.secondary)
            }
        }
        if isEditing {
            ComposerEditBanner(onCancelEdit: onCancelEdit, isIMessage: isIMessage)
        }
    }
}

struct ComposerEditBanner: View {
    let onCancelEdit: (() -> Void)?
    var isIMessage = false

    @ViewBuilder var body: some View {
        if isIMessage {
            iMessageBanner
        } else {
            originalBanner
        }
    }

    private var originalBanner: some View {
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

    private var iMessageBanner: some View {
        HStack(spacing: 9) {
            Image(systemName: "pencil")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)

            Text("Editing message")
                .font(.system(size: 13.5, weight: .medium))
                .foregroundStyle(.primary)

            Spacer(minLength: 0)

            Button {
                onCancelEdit?()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: 30, height: 30)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel edit")
        }
        .padding(.leading, 12)
        .padding(.trailing, 5)
        .frame(height: 40)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: 13, style: .continuous)
        )
        .transition(.opacity)
    }
}

// This is presentation only: the recording phases and callbacks are still
// owned by VoiceInputController. No new microphone or send behavior is added.
private struct IMessageVoiceStatusView: View {
    let status: String
    let phase: VoiceInputController.Phase

    var body: some View {
        HStack(spacing: 10) {
            statusIcon
                .frame(width: 26, height: 24)

            Text(status)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 40)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: 13, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var statusIcon: some View {
        switch phase {
        case .recording:
            IMessageVoiceWaveform()
        case .authorizing, .finishing:
            ProgressView()
                .controlSize(.small)
                .tint(.primary)
        case .idle:
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 16))
                .foregroundStyle(.red)
        }
    }
}

// A tiny time-driven visual waveform; it does not sample microphone data.
private struct IMessageVoiceWaveform: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.12)) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            HStack(alignment: .center, spacing: 2.5) {
                ForEach(0..<6, id: \.self) { index in
                    Capsule()
                        .fill(Color.primary)
                        .frame(
                            width: 2.5,
                            height: 5 + 15 * abs(sin(time * 6.5 + Double(index) * 0.85))
                        )
                }
            }
            .frame(width: 26, height: 24)
        }
        .accessibilityHidden(true)
    }
}

struct ComposerAttachmentMenu: View {
    let onPickPhoto: (() -> Void)?
    let onTakePhoto: (() -> Void)?
    let onPickFile: (() -> Void)?
    var canAttach = true
    let onStartVoiceCall: (() -> Void)?
    var canStartVoiceCall = false

    var body: some View {
        Menu {
            Button {
                onPickPhoto?()
            } label: {
                Label("Photo", systemImage: "photo")
            }
            .disabled(!canAttach)

            Button {
                onTakePhoto?()
            } label: {
                Label("Camera", systemImage: "camera")
            }
            .disabled(!canAttach)

            Button {
                onPickFile?()
            } label: {
                Label("File", systemImage: "doc")
            }
            .disabled(!canAttach)

            Divider()

            Button {
                onStartVoiceCall?()
            } label: {
                Label("Call Claude", systemImage: "phone.fill")
            }
            .disabled(!canStartVoiceCall)
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
