import SwiftUI
import UIKit
import ImageIO

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
    var attachments: [NativeLiveComposerAttachmentDraft] = []
    var onCancelEdit: (() -> Void)? = nil
    var onPickPhoto: (() -> Void)? = nil
    var onTakePhoto: (() -> Void)? = nil
    var onPickFile: (() -> Void)? = nil
    var onRemoveAttachment: ((UUID) -> Void)? = nil
    var onRetryAttachment: ((UUID) -> Void)? = nil
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

            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            if attachment.kind == .image,
                               attachment.data != nil {
                                NativeLiveComposerImageAttachmentTile(
                                    attachment: attachment,
                                    onRemove: {
                                        onRemoveAttachment?(attachment.id)
                                    },
                                    onRetry: {
                                        onRetryAttachment?(attachment.id)
                                    }
                                )
                            } else {
                                NativeLiveComposerAttachmentChip(
                                    attachment: attachment,
                                    onRemove: {
                                        onRemoveAttachment?(attachment.id)
                                    },
                                    onRetry: {
                                        onRetryAttachment?(attachment.id)
                                    }
                                )
                            }
                        }
                    }
                    .padding(.horizontal, 1)
                }
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
                .disabled(
                    isRuntimeTurnActive
                        || isSending
                        || attachments.count >= 8
                )

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

                    guard hasSendableContent,
                          attachmentsReady,
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
                .buttonStyle(
                    ComposerPrimaryActionButtonStyle(
                        isVisuallyDimmed:
                            shouldDimPrimaryAction
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

        return normalized.isEmpty && attachments.isEmpty
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

        return normalized.isEmpty && attachments.isEmpty
            ? .semibold
            : .regular
    }

    private var shouldDimPrimaryAction: Bool {
        isRuntimeControlInFlight
            || (
                isSending
                && !isRuntimeTurnActive
            )
            || (
                !isRuntimeTurnActive
                && !attachmentsReady
            )
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


private struct ComposerPrimaryActionButtonStyle: ButtonStyle {
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


private func nativeLiveComposerThumbnail(
    _ data: Data
) -> UIImage? {
    guard let source =
            CGImageSourceCreateWithData(
                data as CFData,
                nil
            ) else {
        return nil
    }

    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways:
            true,
        kCGImageSourceCreateThumbnailWithTransform:
            true,
        kCGImageSourceThumbnailMaxPixelSize:
            320,
        kCGImageSourceShouldCacheImmediately:
            true,
    ]

    guard let image =
            CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                options as CFDictionary
            ) else {
        return nil
    }

    return UIImage(cgImage: image)
}


private struct NativeLiveComposerImageAttachmentTile: View {
    @EnvironmentObject private var appModel: AppModel

    let attachment: NativeLiveComposerAttachmentDraft
    let onRemove: () -> Void
    let onRetry: () -> Void

    @State private var localPreviewImage: UIImage?
    @State private var remotePreviewImage: UIImage?
    @State private var isLoadingRemotePreview = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image =
                        localPreviewImage
                        ?? remotePreviewImage {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Color.chatSoftFill

                        if isLoadingRemotePreview {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "photo")
                                .font(.system(size: 19))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(width: 72, height: 72)
            .clipped()
            .clipShape(
                RoundedRectangle(
                    cornerRadius: 13,
                    style: .continuous
                )
            )

            attachmentStateOverlay

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(
                        size: 9,
                        weight: .bold
                    ))
                    .foregroundStyle(.primary)
                    .frame(width: 22, height: 22)
                    .background(
                        .ultraThinMaterial,
                        in: Circle()
                    )
            }
            .buttonStyle(.plain)
            .padding(4)
            .accessibilityLabel("Remove attachment")
        }
        .frame(width: 72, height: 72)
        .task(id: attachment.id) {
            loadLocalPreviewIfNeeded()
        }
        .task(
            id: attachment.remoteAttachmentID
        ) {
            await loadRemotePreviewIfNeeded()
        }
    }

    @MainActor
    private func loadLocalPreviewIfNeeded() {
        guard localPreviewImage == nil,
              let data = attachment.data else {
            return
        }
        localPreviewImage =
            nativeLiveComposerThumbnail(data)
    }

    @MainActor
    private func loadRemotePreviewIfNeeded() async {
        guard localPreviewImage == nil,
              remotePreviewImage == nil,
              let attachmentID =
                attachment.remoteAttachmentID else {
            return
        }

        isLoadingRemotePreview = true
        defer {
            isLoadingRemotePreview = false
        }

        do {
            let data =
                try await appModel.nativeLiveAttachmentData(
                    attachmentID: attachmentID,
                    expectedSize:
                        attachment.sizeBytes,
                    expectedSHA256:
                        attachment.sha256
                )
            remotePreviewImage =
                nativeLiveComposerThumbnail(data)
        } catch {
            return
        }
    }

    @ViewBuilder
    private var attachmentStateOverlay: some View {
        switch attachment.state {
        case .uploading:
            ZStack {
                Color.black.opacity(0.16)

                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
            }
            .clipShape(
                RoundedRectangle(
                    cornerRadius: 13,
                    style: .continuous
                )
            )
            .allowsHitTesting(false)

        case .ready:
            EmptyView()

        case .failed:
            Button {
                onRetry()
            } label: {
                ZStack {
                    Color.black.opacity(0.34)

                    Image(systemName: "arrow.clockwise")
                        .font(.system(
                            size: 16,
                            weight: .semibold
                        ))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .clipShape(
                RoundedRectangle(
                    cornerRadius: 13,
                    style: .continuous
                )
            )
            .accessibilityLabel("Retry upload")
        }
    }
}


private struct NativeLiveComposerAttachmentChip: View {
    let attachment: NativeLiveComposerAttachmentDraft
    let onRemove: () -> Void
    let onRetry: () -> Void

    private var fileTypeLabel: String {
        let ext = (attachment.filename as NSString)
            .pathExtension
            .uppercased()

        if !ext.isEmpty {
            return ext
        }

        switch attachment.mimeType {
        case "application/pdf":
            return "PDF"
        case "text/plain":
            return "TXT"
        case "text/markdown":
            return "MD"
        case "application/json":
            return "JSON"
        case "application/zip":
            return "ZIP"
        default:
            return attachment.kind == .image
                ? "Image"
                : "File"
        }
    }

    private var sizeText: String? {
        guard let count =
                attachment.sizeBytes
                ?? attachment.data?.count else {
            return nil
        }

        return ByteCountFormatter.string(
            fromByteCount: Int64(count),
            countStyle: .file
        )
    }

    private var fileSymbol: String {
        let ext = (attachment.filename as NSString)
            .pathExtension
            .lowercased()

        if attachment.kind == .image {
            return "photo"
        }

        if attachment.mimeType == "application/pdf"
            || ext == "pdf" {
            return "doc.richtext"
        }

        if [
            "zip", "tar", "gz", "7z", "rar",
        ].contains(ext) {
            return "archivebox"
        }

        if [
            "csv", "xls", "xlsx", "numbers",
        ].contains(ext) {
            return "tablecells"
        }

        if attachment.mimeType.hasPrefix("video/") {
            return "play.rectangle"
        }

        if attachment.mimeType.hasPrefix("audio/") {
            return "waveform"
        }

        return "doc"
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: fileSymbol)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.filename)
                    .font(.system(
                        size: 12.5,
                        weight: .medium
                    ))
                    .lineLimit(1)

                HStack(spacing: 5) {
                    Text(fileTypeLabel)

                    if let sizeText {
                        Text("·")
                        Text(sizeText)
                    }
                }
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
            }
            .frame(
                maxWidth: 158,
                alignment: .leading
            )

            attachmentState

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(
                        size: 9.5,
                        weight: .semibold
                    ))
                    .foregroundStyle(.secondary)
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove attachment")
        }
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(height: 46)
        .background(
            Color.chatSoftFill,
            in: RoundedRectangle(
                cornerRadius: 13,
                style: .continuous
            )
        )
    }

    @ViewBuilder
    private var attachmentState: some View {
        switch attachment.state {
        case .uploading:
            ProgressView()
                .controlSize(.mini)

        case .ready:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)

        case .failed:
            Button {
                onRetry()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(
                        size: 11,
                        weight: .semibold
                    ))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Retry upload")
        }
    }
}
