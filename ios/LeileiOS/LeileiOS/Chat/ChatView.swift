import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

struct ChatView: View {
    @EnvironmentObject var appModel: AppModel
    @Environment(\.scenePhase) var scenePhase

    let isDraftConversation: Bool
    let draftConversationID: UUID
    let onDraftCommitted: () -> Void

    @StateObject var voiceInput = VoiceInputController()
    @State private var isNativeCallPresented = false
    @State private var voiceLanguage: VoiceInputLanguage = .english
    @State var messageText = ""
    @AppStorage(ChatTheme.storageKey) private var chatThemeRawValue =
        ChatTheme.original.rawValue
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible

    private var selectedChatTheme: ChatTheme {
        ChatTheme(rawValue: chatThemeRawValue) ?? .original
    }
    @State var sendFailureMessage: String?
    @AppStorage("nativeLive.model") var model: NativeLiveClaudeModel = .opus55
    @State var thinking: NativeLiveThinkingMode = .adaptive
    @AppStorage("nativeLive.effort") var effort: NativeLiveEffortLevel = .high
    @State var editDraft: NativeLiveEditDraft?
    var pendingOperation: NativeLivePendingOperation? {
        get { appModel.nativeLivePendingOperation }
        nonmutating set { appModel.nativeLivePendingOperation = newValue }
    }
    @State var isDraftCommitInFlight = false
    @State var isRuntimeControlInFlight = false
    @State var pendingMidTurnDelivery:
        NativeLivePendingMidTurnDelivery?
    @State private var isSystemKeyboardVisible = false
    @State var composerAttachments:
        [NativeLiveComposerAttachmentDraft] = []
    @State private var isPhotoPickerPresented = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var isFileImporterPresented = false
    @State private var isCameraPresented = false
    @FocusState var isComposerFocused: Bool

    var body: some View {
        ZStack {
            // A single fixed wallpaper lives behind the whole AppShell.
            // Suppress the opaque fallback only while it is visible.
            if !iMessageWallpaperVisible {
                Color(.systemBackground)
                    .ignoresSafeArea()
            }

            if isDraftConversation && pendingOperation == nil {
                NativeLiveMessageSurface.scrollableState { Color.clear }
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
        .task(id: appModel.activeNativeLiveConversationID) {
            guard !isDraftConversation else { return }
            await refreshConversationPage()
            await appModel.recoverActiveNativeLiveTurn()
        }
        .task(id: appModel.isAuthenticated) {
            guard appModel.isAuthenticated else { return }
            await appModel.refreshNativeLiveConversations()
            guard !isDraftConversation else { return }
            await refreshConversationPage()
        }
        .onDisappear {
            voiceInput.cancel()
            appModel.stopNativeLiveConversationHeadObservation()
        }
        .onChange(of: voiceEnabled) { _, enabled in
            guard !enabled, voiceInput.isActive else { return }
            voiceInput.cancel()
        }
        .onChange(of: appModel.activeNativeLiveConversationID) { _, _ in
            voiceInput.cancel()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                voiceInput.cancel()
                appModel.stopNativeLiveConversationHeadObservation()
            }
            guard phase == .active else { return }
            Task {
                await appModel.refreshNativeLiveConversations()
                guard !isDraftConversation else { return }
                await refreshConversationPage()
            }
        }
        .onChange(of: draftConversationID) { _, _ in
            voiceInput.cancel()
            messageText = ""
            composerAttachments = []
            editDraft = nil
            pendingOperation = nil
            pendingMidTurnDelivery = nil
            isComposerFocused = false
        }
        .onChange(of: isDraftConversation) { wasDraft, isDraft in
            if wasDraft && !isDraft && !isDraftCommitInFlight {
                messageText = ""
            }
        }
        .onChange(of: pendingMidTurnDeliverySignal) { _, signal in
            reconcilePendingMidTurnDelivery(signal)
        }
        .onChange(of: visibleRuntimeSurface?.prepareID) { oldID, newID in
            guard pendingMidTurnDelivery != nil,
                  oldID != newID else {
                return
            }
            // If the active turn disappears or changes before exact provider
            // acceptance is observed, keep the typed text and unlock retry.
            pendingMidTurnDelivery = nil
        }
        // Native safe-area placement without a toolbar's opaque bar backdrop.
        // Original keeps its existing geometry; only the iMessage
        // presentation uses the requested visual placement and fixed gutters.
        .safeAreaInset(edge: .bottom, spacing: selectedChatTheme == .iMessage ? 0 : nil) {
            if selectedChatTheme == .original {
                chatComposer
                    .padding(.horizontal, ChatPresentationLayout.composerOuterHorizontal)
                    .padding(.top, ChatPresentationLayout.composerOuterTop)
                    .padding(.bottom, ChatPresentationLayout.composerOuterBottom)
                    .offset(
                        y: isSystemKeyboardVisible
                            ? 0
                            : ChatPresentationLayout.composerHiddenKeyboardPaintOffset
                    )
            } else {
                // Keep the requested 10pt visual lowering while the keyboard
                // is hidden. Once it appears, use real layout padding so the
                // input never paints into the keyboard boundary.
                chatComposer
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, isSystemKeyboardVisible ? 12 : 8)
                    .offset(y: isSystemKeyboardVisible ? 0 : 10)
            }
        }
        .sheet(isPresented: $isNativeCallPresented) {
            if let conversationID = appModel.activeNativeLiveConversationID {
                NavigationStack {
                    NativeLiveCallView(
                        conversationID: conversationID,
                        execution: executionSelection
                    )
                }
                .environmentObject(appModel)
            }
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
        .alert("Failed", isPresented: Binding(
            get: { sendFailureMessage != nil },
            set: { if !$0 { sendFailureMessage = nil } }
        )) {
            Button("OK", role: .cancel) { sendFailureMessage = nil }
        } message: {
            Text(sendFailureMessage ?? "")
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
        .environment(\.chatTheme, selectedChatTheme)
    }

    // Exactly one composer owner. Original and iMessage both use the native
    // safe-area mechanism, with separate visual layout and spacing.
    private var chatComposer: some View {
        ChatComposer(
            text: $messageText,
            model: $model,
            thinking: $thinking,
            effort: $effort,
            voiceLanguage: $voiceLanguage,
            isFocused: $isComposerFocused,
            isSending:
                appModel.chatSendState == .sending
                    || voiceInput.isActive
                    || isDraftCommitInFlight
                    || pendingOperation != nil
                    || isRuntimeTurnActive,
            isRuntimeTurnActive:
                isRuntimeTurnActive,
            isRuntimeControlInFlight:
                isRuntimeControlInFlight
                    || pendingMidTurnDelivery != nil,
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
            canStartVoiceCall:
                !isDraftConversation
                    && appModel.isAuthenticated
                    && appModel.activeNativeLiveConversationID != nil
                    && appModel.chatSendState != .sending
                    && !isRuntimeTurnActive
                    && pendingOperation == nil
                    && !voiceInput.isActive,
            onStartVoiceCall: {
                voiceInput.cancel()
                isComposerFocused = false
                isNativeCallPresented = true
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
            },
            voiceEnabled: voiceEnabled,
            voiceStatus: voiceInput.status,
            voicePhase: voiceInput.phase,
            onVoiceInteractionBegin: {
                voiceInput.dismissStatusMessage()
            },
            onVoicePress: {
                voiceInput.begin(
                    language: voiceLanguage,
                    onTranscript: sendVoiceMessage
                )
            },
            onVoiceRelease: { voiceInput.release() }
        ) {
            sendMessage()
        }
    }

}
