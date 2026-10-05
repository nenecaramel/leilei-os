import SwiftUI

struct ChatComposer: View {
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
    var onRemoveAttachment: ((UUID) -> Void)? = nil
    var onRetryAttachment: ((UUID) -> Void)? = nil
    var onInterrupt: (() -> Void)? = nil
    var onMidTurnInput: ((String) -> Void)? = nil
    var voiceEnabled = false
    var voiceStatus: String? = nil
    var onVoiceInteractionBegin: (() -> Void)? = nil
    var onVoicePress: (() -> Void)? = nil
    var onVoiceRelease: (() -> Void)? = nil
    var onSend: (() -> Void)? = nil


    var body: some View {
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

    private var controlRow: some View {
        HStack(spacing: ChatPresentationLayout.composerRowSpacing) {
            ComposerAttachmentMenu(
                onPickPhoto: onPickPhoto,
                onTakePhoto: onTakePhoto,
                onPickFile: onPickFile
            )
            .disabled(
                isRuntimeTurnActive
                    || isSending
                    || attachments.count >= 8
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

    private var composerActionLabel: some View {
        ComposerPrimaryActionLabel(presentation: actionPresentation)
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
