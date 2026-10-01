import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

struct ChatView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.scenePhase) private var scenePhase

    let isDraftConversation: Bool
    let draftConversationID: UUID
    @Binding var selectedWorkspaceID: String?
    let onDraftCommitted: () -> Void

    @State private var messageText = ""
    @State private var model: NativeLiveClaudeModel = .opus55
    @State private var thinking: NativeLiveThinkingMode = .adaptive
    @State private var effort: NativeLiveEffortLevel = .high
    @State private var editDraft: NativeLiveEditDraft?
    @State private var pendingOperation: NativeLivePendingOperation?
    @State private var isDraftCommitInFlight = false
    @State private var isRuntimeControlInFlight = false
    @State private var isSystemKeyboardVisible = false
    @State private var composerAttachments:
        [NativeLiveComposerAttachmentDraft] = []
    @State private var isPhotoPickerPresented = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var isFileImporterPresented = false
    @State private var isCameraPresented = false
    @FocusState private var isComposerFocused: Bool

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            if isDraftConversation && pendingOperation == nil {
                Color.clear
            } else {
                NativeLiveMessageSurface(
                    snapshot:
                        isDraftConversation
                            ? nil
                            : appModel.nativeLiveCurrentPath,
                    historySnapshot:
                        isDraftConversation
                            ? nil
                            : appModel.nativeLiveHistorySnapshot,
                    syncState: appModel.chatSyncState,
                    isAuthenticated: appModel.isAuthenticated,
                    hasActiveConversation:
                        !isDraftConversation
                            && appModel.activeNativeLiveConversationID != nil,
                    isTurnInFlight:
                        appModel.chatSendState == .sending
                            || pendingOperation != nil
                            || isRuntimeTurnActive,
                    pendingOperation: pendingOperation,
                    runtimeSurface: visibleRuntimeSurface,
                    onResolveRuntimeInteraction: {
                        interaction,
                        response in
                        try await appModel.resolveNativeLiveRuntimeInteraction(
                            interaction,
                            response: response
                        )
                    },
                    onRefresh: {
                        await appModel.refreshNativeLiveCurrentPath(force: true)
                    },
                    onLoadOlder: {
                        await appModel.loadOlderNativeLiveMessages()
                    },
                    onRetryMessage: { targetUserMessageID in
                        retryMessage(targetUserMessageID)
                    },
                    onEditMessage: { message in
                        beginEditing(message)
                    }
                )
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            isComposerFocused = false
        }
        .task(id: appModel.activeNativeLiveConversationID) {
            guard !isDraftConversation else { return }
            await appModel.refreshNativeLiveConversationHistorySnapshot()
            await appModel.refreshNativeLiveCurrentPath()
            await appModel.recoverActiveNativeLiveTurn()
        }
        .task(id: appModel.isAuthenticated) {
            guard appModel.isAuthenticated else { return }
            await appModel.refreshNativeLiveConversations()
            guard !isDraftConversation else { return }
            await appModel.refreshNativeLiveConversationHistorySnapshot()
            await appModel.refreshNativeLiveCurrentPath()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await appModel.refreshNativeLiveConversations()
                guard !isDraftConversation else { return }
                await appModel.refreshNativeLiveConversationHistorySnapshot()
                await appModel.refreshNativeLiveCurrentPath()
            }
        }
        .onChange(of: draftConversationID) { _, _ in
            messageText = ""
            composerAttachments = []
            editDraft = nil
            pendingOperation = nil
            isComposerFocused = false
        }
        .onChange(of: isDraftConversation) { wasDraft, isDraft in
            if wasDraft && !isDraft && !isDraftCommitInFlight {
                messageText = ""
            }
        }
        .safeAreaInset(edge: .bottom) {
            ChatComposer(
                text: $messageText,
                model: $model,
                thinking: $thinking,
                effort: $effort,
                isFocused: $isComposerFocused,
                isSending:
                    appModel.chatSendState == .sending
                        || isDraftCommitInFlight
                        || pendingOperation != nil
                        || isRuntimeTurnActive,
                isRuntimeTurnActive:
                    isRuntimeTurnActive,
                isRuntimeControlInFlight:
                    isRuntimeControlInFlight,
                interruptRequested:
                    runtimeInterruptRequested,
                isEditing: editDraft != nil,
                attachments: composerAttachments,
                onCancelEdit: cancelEditing,
                onPickPhoto: {
                    isPhotoPickerPresented = true
                },
                onTakePhoto: {
                    isCameraPresented = true
                },
                onPickFile: {
                    isFileImporterPresented = true
                },
                onRemoveAttachment: { id in
                    composerAttachments.removeAll {
                        $0.id == id
                    }
                },
                onRetryAttachment: { id in
                    retryAttachmentUpload(id)
                },
                onInterrupt: {
                    interruptCurrentTurn()
                },
                onMidTurnInput: { text in
                    sendMidTurnInput(text)
                }
            ) {
                sendMessage()
            }
            .padding(.horizontal, 12)
            .padding(.top, 18)
            .padding(.bottom, 10)
            .offset(
                y: isSystemKeyboardVisible
                    ? 0
                    : 10
            )
        }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $photoPickerItems,
            maxSelectionCount:
                max(1, 8 - composerAttachments.count),
            matching: .images
        )
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { @MainActor in
                await importPhotos(items)
                photoPickerItems = []
            }
        }
        .fileImporter(
            isPresented: $isFileImporterPresented,
            allowedContentTypes: [.data],
            allowsMultipleSelection: true
        ) { result in
            Task { @MainActor in
                await importFiles(result)
            }
        }
        .sheet(isPresented: $isCameraPresented) {
            NativeLiveCameraPicker { data in
                isCameraPresented = false
                guard let data else { return }
                addAttachment(
                    data: data,
                    filename:
                        "Camera-"
                        + UUID().uuidString.lowercased()
                        + ".jpg",
                    mimeType: "image/jpeg",
                    kind: .image
                )
            }
            .ignoresSafeArea()
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillShowNotification
            )
        ) { _ in
            isSystemKeyboardVisible = true
        }
        .onReceive(
            NotificationCenter.default.publisher(
                for: UIResponder.keyboardWillHideNotification
            )
        ) { _ in
            isSystemKeyboardVisible = false
        }
        .overlay {
            if isConversationLoading {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
                    .ignoresSafeArea()
            }
        }
    }

    private var visibleRuntimeSurface:
        NativeLiveRuntimeSurfaceState? {
        guard let surface = appModel.nativeLiveRuntimeSurface,
              surface.conversationID
                == appModel.activeNativeLiveConversationID else {
            return nil
        }
        return surface
    }

    private var isRuntimeTurnActive: Bool {
        if let nativeState =
            visibleRuntimeSurface?.providerTurnActive {
            return nativeState
        }
        return visibleRuntimeSurface != nil
    }

    private var runtimeInterruptRequested: Bool {
        visibleRuntimeSurface?.controls.contains {
            $0.kind == "interrupt"
                && $0.status != "failed"
        } == true
    }

    private func sendMidTurnInput(
        _ text: String
    ) {
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !normalized.isEmpty,
              !isRuntimeControlInFlight,
              isRuntimeTurnActive else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                try await appModel.sendNativeLiveMidTurnInput(
                    normalized
                )

                if messageText.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ) == normalized {
                    messageText = ""
                }
                isComposerFocused = true
            } catch {
                // Preserve the typed text. The control may be retried
                // explicitly by the user; never blind-retry an ambiguous send.
            }
        }
    }

    private func interruptCurrentTurn() {
        guard !isRuntimeControlInFlight,
              !runtimeInterruptRequested,
              isRuntimeTurnActive else {
            return
        }

        isRuntimeControlInFlight = true

        Task { @MainActor in
            defer {
                isRuntimeControlInFlight = false
            }

            do {
                try await appModel.interruptNativeLiveTurn()
            } catch {
                // Never blind-retry an interrupt with unknown delivery.
            }
        }
    }

    private var isConversationLoading: Bool {
        guard pendingOperation == nil,
              !isDraftConversation,
              appModel.isAuthenticated,
              appModel.activeNativeLiveConversationID != nil,
              appModel.nativeLiveCurrentPath == nil else {
            return false
        }

        return appModel.chatSyncState == .idle
            || appModel.chatSyncState == .loading
    }

    private func retryMessage(
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
                    execution: executionSelection
                )
            } catch {
            }

            pendingOperation = nil
        }
    }

    private func beginEditing(
        _ message: NativeLiveCurrentPathMessage
    ) {
        guard message.role == "user",
              pendingOperation == nil,
              appModel.chatSendState != .sending else {
            return
        }

        let text = message.displayText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        let existingAttachments =
            message.blocks.compactMap(
                composerAttachmentFromCanonicalBlock
            )
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

    private func cancelEditing() {
        editDraft = nil
        messageText = ""
        composerAttachments = []
        isComposerFocused = false
    }

    private var executionSelection: NativeLiveExecutionSelection {
        NativeLiveExecutionSelection(
            model: model,
            thinking: thinking,
            effort: effort
        )
    }

    private func sendMessage() {
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
                    appModel.nativeLiveCurrentPath?.syncToken
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
                        execution: executionSelection
                    )
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

        let shouldCreateConversation = isDraftConversation
        pendingOperation = NativeLivePendingOperation(
            kind: .send(text: pendingText),
            baselineSyncToken:
                appModel.nativeLiveCurrentPath?.syncToken
        )
        messageText = ""
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

                let shouldBindWorkspace =
                    shouldCreateConversation
                    || appModel.nativeLiveCurrentPath?
                        .currentHeadMessageId == nil
                try await appModel.sendNativeLiveMessage(
                    pendingText,
                    attachmentIDs: attachmentIDs,
                    workspaceID:
                        shouldBindWorkspace
                            ? selectedWorkspaceID
                            : nil,
                    execution: executionSelection
                )
                pendingOperation = nil
            } catch {
                pendingOperation = nil
                composerAttachments = pendingAttachments

                if messageText.trimmingCharacters(
                    in: .whitespacesAndNewlines
                ).isEmpty {
                    messageText = pendingText
                }
            }

            isDraftCommitInFlight = false
        }
    }

    private func addAttachment(
        data: Data,
        filename: String,
        mimeType: String,
        kind: NativeLiveComposerAttachmentKind
    ) {
        guard composerAttachments.count < 8,
              !data.isEmpty,
              data.count <= 20 * 1024 * 1024 else {
            return
        }
        let draft = NativeLiveComposerAttachmentDraft(
            filename: filename,
            mimeType: mimeType,
            kind: kind,
            data: data
        )
        composerAttachments.append(draft)
        uploadAttachment(draft.id)
    }

    private func retryAttachmentUpload(_ id: UUID) {
        guard let index = composerAttachments.firstIndex(
            where: { $0.id == id }
        ),
        composerAttachments[index].data != nil else {
            return
        }
        composerAttachments[index].state = .uploading
        uploadAttachment(id)
    }

    private func uploadAttachment(_ id: UUID) {
        guard let draft = composerAttachments.first(
            where: { $0.id == id }
        ),
        let data = draft.data else {
            return
        }

        Task { @MainActor in
            do {
                let ready =
                    try await appModel.uploadNativeLiveAttachment(
                        data: data,
                        filename: draft.filename,
                        mimeType: draft.mimeType,
                        kind: draft.kind
                    )
                guard let index =
                        composerAttachments.firstIndex(
                            where: { $0.id == id }
                        ) else {
                    return
                }
                composerAttachments[index].state =
                    .ready(ready.attachmentId)
            } catch {
                guard let index =
                        composerAttachments.firstIndex(
                            where: { $0.id == id }
                        ) else {
                    return
                }
                composerAttachments[index].state =
                    .failed(error.localizedDescription)
            }
        }
    }

    private func importPhotos(
        _ items: [PhotosPickerItem]
    ) async {
        for item in items.prefix(
            max(0, 8 - composerAttachments.count)
        ) {
            guard let data = try? await item.loadTransferable(
                type: Data.self
            ) else {
                continue
            }
            let contentType =
                item.supportedContentTypes.first
                ?? .jpeg
            let mimeType =
                contentType.preferredMIMEType
                ?? "image/jpeg"
            let fileExtension =
                contentType.preferredFilenameExtension
                ?? "jpg"
            addAttachment(
                data: data,
                filename:
                    "Photo-"
                    + UUID().uuidString.lowercased()
                    + "."
                    + fileExtension,
                mimeType: mimeType,
                kind: .image
            )
        }
    }

    private func importFiles(
        _ result: Result<[URL], Error>
    ) async {
        guard case .success(let urls) = result else {
            return
        }

        for url in urls.prefix(
            max(0, 8 - composerAttachments.count)
        ) {
            let scoped =
                url.startAccessingSecurityScopedResource()
            defer {
                if scoped {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            guard let data = try? Data(contentsOf: url),
                  !data.isEmpty,
                  data.count <= 20 * 1024 * 1024 else {
                continue
            }
            let values = try? url.resourceValues(
                forKeys: [
                    .contentTypeKey,
                    .nameKey,
                ]
            )
            let contentType =
                values?.contentType ?? .data
            addAttachment(
                data: data,
                filename:
                    values?.name
                    ?? (
                        url.lastPathComponent.isEmpty
                            ? "Attachment"
                            : url.lastPathComponent
                    ),
                mimeType:
                    contentType.preferredMIMEType
                    ?? "application/octet-stream",
                kind:
                    contentType.conforms(to: .image)
                        ? .image
                        : .file
            )
        }
    }

    private func composerAttachmentFromCanonicalBlock(
        _ block: NativeLiveCurrentPathBlock
    ) -> NativeLiveComposerAttachmentDraft? {
        guard block.kind == "attachment",
              let payload = block.payload,
              let attachmentID =
                payload["attachment_id"]?.stringValue,
              let filename =
                payload["filename"]?.stringValue,
              let mimeType =
                payload["mime_type"]?.stringValue else {
            return nil
        }
        let kind: NativeLiveComposerAttachmentKind =
            payload["kind"]?.stringValue == "image"
                ? .image
                : .file
        return NativeLiveComposerAttachmentDraft(
            existingAttachmentID: attachmentID,
            filename: filename,
            mimeType: mimeType,
            kind: kind
        )
    }

}


private struct NativeLiveEditDraft {
    let targetUserMessageID: String
    let text: String
}


private struct NativeLiveCameraPicker:
    UIViewControllerRepresentable {
    let onComplete: (Data?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onComplete: onComplete)
    }

    func makeUIViewController(
        context: Context
    ) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType =
            UIImagePickerController.isSourceTypeAvailable(.camera)
                ? .camera
                : .photoLibrary
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(
        _ uiViewController: UIImagePickerController,
        context: Context
    ) {}

    final class Coordinator:
        NSObject,
        UIImagePickerControllerDelegate,
        UINavigationControllerDelegate {
        let onComplete: (Data?) -> Void

        init(onComplete: @escaping (Data?) -> Void) {
            self.onComplete = onComplete
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info:
                [UIImagePickerController.InfoKey: Any]
        ) {
            let image =
                info[.originalImage] as? UIImage
            onComplete(
                image?.jpegData(
                    compressionQuality: 0.92
                )
            )
        }

        func imagePickerControllerDidCancel(
            _ picker: UIImagePickerController
        ) {
            onComplete(nil)
        }
    }
}
