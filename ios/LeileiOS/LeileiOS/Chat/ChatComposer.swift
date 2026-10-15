import SwiftUI

struct ChatComposer: View {
    @Environment(\.chatTheme) private var chatTheme
    @State private var isIMessageModelSettingsPresented = false
    @Binding var text: String
    @Binding var model: NativeLiveClaudeModel
    @Binding var thinking: NativeLiveThinkingMode
    @Binding var effort: NativeLiveEffortLevel
    @Binding var voiceLanguage: VoiceInputLanguage
    var isFocused: FocusState<Bool>.Binding
    var isSending = false
    var isRuntimeTurnActive = false
    var isRuntimeControlInFlight = false
    var interruptRequested = false
    var isEditing = false
    var attachments: [NativeLiveComposerAttachmentDraft] = []
    var onCancelEdit: (() -> Void)? = nil
    var onPickPhoto: (() -> Void)? = nil
    var onTakePhoto: (() -> Void)? = nil
    var onPickFile: (() -> Void)? = nil
    var canStartVoiceCall = false
    var onStartVoiceCall: (() -> Void)? = nil
    var onRemoveAttachment: ((UUID) -> Void)? = nil
    var onRetryAttachment: ((UUID) -> Void)? = nil
    var onInterrupt: (() -> Void)? = nil
    var onMidTurnInput: ((String) -> Void)? = nil
    var voiceEnabled = false
    var voiceStatus: String? = nil
    var voicePhase: VoiceInputController.Phase = .idle
    var onVoiceInteractionBegin: (() -> Void)? = nil
    var onVoicePress: (() -> Void)? = nil
    var onVoiceRelease: (() -> Void)? = nil
    var onSend: (() -> Void)? = nil


    // Both shells initially use exactly the original paint. Subsequent work
    // replaces only the iMessage branch, keeping bindings and actions shared.
    @ViewBuilder
    var body: some View {
        switch chatTheme {
        case .original:
            sharedComposerContent
        case .iMessage:
            iMessageComposerContent
        }
    }

    private var sharedComposerContent: some View {
        VStack(alignment: .leading, spacing: ChatPresentationLayout.composerSectionSpacing) {
            ComposerStatusArea(
                voiceStatus: voiceStatus,
                isEditing: isEditing,
                onCancelEdit: onCancelEdit
            )

            if !attachments.isEmpty {
                ComposerAttachmentStrip(
                    attachments: attachments,
                    onRemoveAttachment: onRemoveAttachment,
                    onRetryAttachment: onRetryAttachment
                )
                .transition(.opacity)
            }

            NativeLiveComposerTextInput(
                text: $text,
                textSnapshot: text,
                isFocused: isFocused,
                focusSnapshot: isFocused.wrappedValue
            )
            .equatable()

            controlRow
        }
        .padding(.horizontal, ChatPresentationLayout.composerHorizontalInset)
        .padding(.top, ChatPresentationLayout.composerTopInset)
        .padding(.bottom, ChatPresentationLayout.composerBottomInset)
        .glassEffect(
            .regular,
            in: RoundedRectangle(
                cornerRadius: LeileiUI.Radius.composer,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: LeileiUI.Radius.composer,
                style: .continuous
            )
            .stroke(Color.primary.opacity(0.08), lineWidth: 0.6)
        }
    }

    // iMessage shell: same draft, focus, actions and runtime guards as Original.
    // Only the native SwiftUI arrangement changes.
    private var iMessageComposerContent: some View {
        VStack(alignment: .leading, spacing: 8) {
            ComposerStatusArea(
                voiceStatus: voiceStatus,
                isEditing: isEditing,
                onCancelEdit: onCancelEdit,
                isIMessage: true,
                voicePhase: voicePhase
            )

            if !attachments.isEmpty {
                ComposerAttachmentStrip(
                    attachments: attachments,
                    onRemoveAttachment: onRemoveAttachment,
                    onRetryAttachment: onRetryAttachment
                )
            }

            HStack(alignment: .bottom, spacing: 10) {
                iMessagePlusMenu

                HStack(alignment: .bottom, spacing: 8) {
                    TextField(
                        "",
                        text: $text,
                        prompt: Text("Message")
                            .foregroundStyle(Color.primary.opacity(0.35)),
                        axis: .vertical
                    )
                    .focused(isFocused)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineLimit(1...6)
                    .padding(.vertical, 9)
                    .padding(.leading, 14)

                    primaryActionButton
                        .padding(.trailing, 4)
                        .padding(.bottom, 3)
                }
                .frame(minHeight: 42)
                .glassEffect(.regular, in: Capsule())
            }
        }
    }

    private var iMessagePlusMenu: some View {
        Menu {
            Button {
                onPickPhoto?()
            } label: {
                Label("Photo", systemImage: "photo")
            }
            .disabled(!canAttachFromIMessage)

            Button {
                onTakePhoto?()
            } label: {
                Label("Camera", systemImage: "camera")
            }
            .disabled(!canAttachFromIMessage)

            Button {
                onPickFile?()
            } label: {
                Label("File", systemImage: "doc")
            }
            .disabled(!canAttachFromIMessage)

            Divider()

            Button {
                onStartVoiceCall?()
            } label: {
                Label("Call Claude", systemImage: "phone.fill")
            }
            .disabled(!canStartVoiceCall)

            Divider()

            // A native nested Menu adds an unwanted, non-removable
            // "Model Settings" navigation header above its options on iOS 26.
            // Present the second level separately so its first row is a choice.
            Button {
                isIMessageModelSettingsPresented = true
            } label: {
                Label("Model Settings", systemImage: "slider.horizontal.3")
            }

            if isFocused.wrappedValue {
                Divider()

                Button {
                    isFocused.wrappedValue = false
                } label: {
                    Label("Dismiss Keyboard", systemImage: "keyboard.chevron.compact.down")
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(.primary)
                .frame(width: 42, height: 42)
                .glassEffect(.regular, in: Circle())
                .contentShape(Circle())
        }
        .accessibilityLabel("Attachments and model settings")
        .popover(
            isPresented: $isIMessageModelSettingsPresented,
            attachmentAnchor: .rect(.bounds),
            arrowEdge: .bottom
        ) {
            iMessageModelSettingsPanel
                .presentationCompactAdaptation(.popover)
        }
    }

    // Headerless second-level selector. The parent menu still shows the
    // "Model Settings" entry, but its panel starts directly with options.
    // Selection continues to use the same model / thinking / effort bindings.
    private var iMessageModelSettingsPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(model.supportedThinkingModes.reversed())) { option in
                    iMessageModelOption(
                        option.displayName,
                        isSelected: option == thinking
                    ) {
                        thinkingSelection.wrappedValue = option
                        isIMessageModelSettingsPresented = false
                    }
                }

                Divider()
                    .padding(.vertical, 7)

                ForEach(availableEffortLevels) { option in
                    iMessageModelOption(
                        option.displayName,
                        isSelected: option == effort
                    ) {
                        $effort.wrappedValue = option
                        isIMessageModelSettingsPresented = false
                    }
                }

                Divider()
                    .padding(.vertical, 7)

                ForEach(Array(NativeLiveClaudeModel.allCases.reversed())) { option in
                    iMessageModelOption(
                        option.displayName,
                        isSelected: option == model
                    ) {
                        modelSelection.wrappedValue = option
                        isIMessageModelSettingsPresented = false
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .frame(width: 266, maxHeight: 510)
        .accessibilityIdentifier("imessage-model-options")
    }

    private func iMessageModelOption(
        _ title: String,
        isSelected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .opacity(isSelected ? 1 : 0)
                    .frame(width: 19, alignment: .center)

                Text(title)
                    .font(.system(size: 16))
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(isSelected ? "Selected" : "")
    }

    private var canAttachFromIMessage: Bool {
        !isRuntimeTurnActive && !isSending && attachments.count < 8
    }

    private var controlRow: some View {
        HStack(spacing: ChatPresentationLayout.composerRowSpacing) {
            ComposerAttachmentMenu(
                onPickPhoto: onPickPhoto,
                onTakePhoto: onTakePhoto,
                onPickFile: onPickFile,
                canAttach: !isRuntimeTurnActive
                    && !isSending
                    && attachments.count < 8,
                onStartVoiceCall: onStartVoiceCall,
                canStartVoiceCall: canStartVoiceCall
            )

            ComposerModelMenu(
                model: model,
                effort: $effort,
                modelSelection: modelSelection,
                thinkingSelection: thinkingSelection,
                modelOptions: Array(NativeLiveClaudeModel.allCases.reversed()),
                availableEffortLevels: availableEffortLevels,
                thinkingOptions: Array(model.supportedThinkingModes.reversed())
            )

            Spacer(minLength: 0)

            Button {
                isFocused.wrappedValue = false
            } label: {
                ComposerCircleButton(
                    systemName: "chevron.down"
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss keyboard")

            primaryActionButton
        }
    }

    @ViewBuilder private var primaryActionButton: some View {
        if isVoiceActionMode {
            voiceActionButton
        } else {
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

                guard hasSendableContent,
                      attachmentsReady,
                      !isSending else {
                    return
                }
                onSend?()
            } label: {
                composerActionLabel
            }
            .buttonStyle(
                ComposerPrimaryActionButtonStyle(
                    isVisuallyDimmed:
                        actionPresentation.isDimmed
                )
            )
            .disabled(
                isRuntimeControlInFlight
                    || (
                        isSending
                        && !isRuntimeTurnActive
                    )
                    || (
                        !isRuntimeTurnActive
                        && (
                            !hasSendableContent
                            || !attachmentsReady
                        )
                    )
            )
        }
    }

    // Read-only paint derivation. Action dispatch and disabled guards here
    // continue to use the original inputs and callbacks.
    private var actionPresentation: ComposerPrimaryActionPresentation {
        ComposerPrimaryActionPresentation(
            hasText: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            hasAttachments: !attachments.isEmpty,
            attachmentsReady: attachmentsReady,
            isRuntimeTurnActive: isRuntimeTurnActive,
            isRuntimeControlInFlight: isRuntimeControlInFlight,
            interruptRequested: interruptRequested,
            isSending: isSending
        )
    }

    private var isVoiceActionMode: Bool {
        actionPresentation.mode == .voice
    }

    @ViewBuilder
    private var composerActionLabel: some View {
        if chatTheme == .iMessage {
            iMessageActionLabel
        } else {
            ComposerPrimaryActionLabel(presentation: actionPresentation)
        }
    }

    // Apple-native SF Symbols and dynamic accent tint; only the paint differs.
    // Button dispatch, the voice gesture bridge and disabled guards are shared.
    @ViewBuilder
    private var iMessageActionLabel: some View {
        switch actionPresentation.mode {
        case .voice:
            Image(systemName: "waveform")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.primary)
                .frame(
                    width: LeileiUI.ControlGeometry.compact,
                    height: LeileiUI.ControlGeometry.compact
                )

        case .interruptPending:
            ProgressView()
                .controlSize(.small)
                .tint(.primary)
                .frame(
                    width: LeileiUI.ControlGeometry.compact,
                    height: LeileiUI.ControlGeometry.compact
                )

        case .interrupt:
            Image(systemName: "stop.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(
                    width: LeileiUI.ControlGeometry.compact,
                    height: LeileiUI.ControlGeometry.compact
                )

        case .send, .midTurnSend, .disabledSend:
            Image(systemName: "arrow.up")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(.tint, in: Circle())
                .frame(
                    width: LeileiUI.ControlGeometry.compact,
                    height: LeileiUI.ControlGeometry.compact
                )
        }
    }

    private var voiceActionButton: some View {
        ZStack {
            composerActionLabel

            NativeLiveVoiceActionControl(
                voiceLanguage: $voiceLanguage,
                isEnabled: voiceEnabled,
                onInteractionBegin: {
                    onVoiceInteractionBegin?()
                },
                onVoicePress: {
                    onVoicePress?()
                },
                onVoiceRelease: {
                    onVoiceRelease?()
                }
            )
        }
        .frame(width: LeileiUI.ControlGeometry.compact, height: LeileiUI.ControlGeometry.compact)
        .opacity(voiceEnabled ? 1 : 0.35)
    }

    private var hasSendableContent: Bool {
        !text.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).isEmpty
            || !attachments.isEmpty
    }

    private var attachmentsReady: Bool {
        attachments.allSatisfy(\.isReady)
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
