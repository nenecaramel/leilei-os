import SwiftUI

struct NativeLiveEditDraft {
    let targetUserMessageID: String
    let text: String
}

extension ChatView {
    func retryMessage(
        _ targetUserMessageID: String
    ) {
        guard pendingOperation == nil,
              appModel.chatSendState != .sending else {
            return
        }

        pendingOperation = NativeLivePendingOperation(
            kind: .retry(
                targetUserMessageID: targetUserMessageID
            ),
            baselineSyncToken:
                appModel.nativeLiveCurrentPath?.syncToken
        )

        Task { @MainActor in
            do {
                try await appModel.retryNativeLiveMessage(
                    targetUserMessageID: targetUserMessageID,
                    execution: executionSelection,
                    presentationOperation: pendingOperation
                )
            } catch {
            }

            pendingOperation = nil
        }
    }

    func beginEditing(
        _ message: NativeLiveCurrentPathMessage
    ) {
        guard message.role == "user",
              pendingOperation == nil,
              appModel.chatSendState != .sending else {
            return
        }

        let text = NativeLiveMessagePresentationProjector.project(.canonical(message)).copyText ?? ""
        let existingAttachments = NativeLiveMessagePresentationProjector.project(.canonical(message))
            .attachmentInputs.compactMap(\.retainedComposerDraft)
        guard !text.isEmpty || !existingAttachments.isEmpty else {
            return
        }

        editDraft = NativeLiveEditDraft(
            targetUserMessageID: message.id,
            text: text
        )
        messageText = text
        composerAttachments = existingAttachments

        Task { @MainActor in
            await Task.yield()
            isComposerFocused = true
        }
    }

    func cancelEditing() {
        editDraft = nil
        messageText = ""
        composerAttachments = []
        isComposerFocused = false
    }

    var executionSelection: NativeLiveExecutionSelection {
        NativeLiveExecutionSelection(
            model: model,
            thinking: thinking,
            effort: effort
        )
    }

    func sendMessage() {
        let pendingText = messageText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let pendingAttachments = composerAttachments
        let attachmentIDs =
            pendingAttachments.compactMap(\.remoteAttachmentID)
        guard (
                !pendingText.isEmpty
                || !pendingAttachments.isEmpty
              ),
              attachmentIDs.count == pendingAttachments.count,
              pendingOperation == nil,
              !isDraftCommitInFlight,
              appModel.chatSendState != .sending else {
            return
        }

        if let draft = editDraft {
            pendingOperation = NativeLivePendingOperation(
                kind: .edit(
                    targetUserMessageID: draft.targetUserMessageID,
                    text: pendingText
                ),
                baselineSyncToken:
                    appModel.nativeLiveCurrentPath?.syncToken,
                presentationAttachments: pendingAttachments.map(\.presentationInput)
            )
            editDraft = nil
            messageText = ""
            composerAttachments = []
            isComposerFocused = false

            Task { @MainActor in
                do {
                    try await appModel.editNativeLiveMessage(
                        targetUserMessageID:
                            draft.targetUserMessageID,
                        text: pendingText,
                        attachmentIDs: attachmentIDs,
                        execution: executionSelection,
                        presentationOperation: pendingOperation
                    )
                    pendingOperation = nil
                } catch NativeLiveSendError.interrupted {
                    pendingOperation = nil
                } catch {
                    pendingOperation = nil
                    editDraft = draft
                    composerAttachments = pendingAttachments

                    if messageText.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty {
                        messageText = pendingText
                    }

                    isComposerFocused = true
                }
            }
            return
        }

        sendNewMessage(pendingText: pendingText, pendingAttachments: pendingAttachments)
    }

    var voiceEnabled: Bool {
        editDraft == nil && !isRuntimeTurnActive && pendingOperation == nil
            && !isDraftCommitInFlight && appModel.chatSendState != .sending
            && composerAttachments.isEmpty && messageText.isEmpty
            && appModel.isAuthenticated && scenePhase == .active
    }

    func sendVoiceMessage(_ transcript: String) {
        guard voiceEnabled else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        sendNewMessage(pendingText: text, pendingAttachments: [], inputMode: .voice)
    }

    func sendNewMessage(
        pendingText: String,
        pendingAttachments: [NativeLiveComposerAttachmentDraft],
        inputMode: NativeLiveInputMode = .text
    ) {
        let attachmentIDs = pendingAttachments.compactMap(\.remoteAttachmentID)
        let shouldCreateConversation = isDraftConversation
        pendingOperation = NativeLivePendingOperation(
            kind: .send(text: pendingText),
            baselineSyncToken:
                appModel.nativeLiveCurrentPath?.syncToken,
            presentationAttachments: pendingAttachments.map(\.presentationInput),
            inputMode: inputMode
        )
        pendingOperation?.isDraftConversation = shouldCreateConversation
        if inputMode == .text { messageText = "" }
        composerAttachments = []
        isComposerFocused = false

        Task { @MainActor in
            do {
                if shouldCreateConversation {
                    isDraftCommitInFlight = true
                    _ = try await appModel.createNativeLiveConversation(
                        title: "New Conversation"
                    )

                    if let pendingOperation {
                        self.pendingOperation =
                            pendingOperation.rebased(
                                to:
                                    appModel.nativeLiveCurrentPath?
                                        .syncToken
                            )
                    }

                    onDraftCommitted()
                }

                try await appModel.sendNativeLiveMessage(
                    pendingText,
                    inputMode: inputMode,
                    attachmentIDs: attachmentIDs,
                    execution: executionSelection,
                    presentationOperation: pendingOperation
                )
                pendingOperation = nil
            } catch NativeLiveSendError.interrupted {
                pendingOperation = nil
            } catch {
                pendingOperation = nil
                if inputMode == .voice {
                    voiceInput.reportSendFailure()
                } else {
                    composerAttachments = pendingAttachments

                    if messageText.trimmingCharacters(
                        in: .whitespacesAndNewlines
                    ).isEmpty {
                        messageText = pendingText
                    }
                }
            }

            isDraftCommitInFlight = false
        }
    }
}
