import SwiftUI

struct ComposerAttachmentStrip: View {
    let attachments: [NativeLiveComposerAttachmentDraft]
    let onRemoveAttachment: ((UUID) -> Void)?
    let onRetryAttachment: ((UUID) -> Void)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: ChatPresentationLayout.composerRowSpacing) {
                ForEach(attachments) { attachment in
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
            .padding(.horizontal, 1)
        }
    }
}

struct NativeLiveComposerAttachmentChip: View {
    @Environment(\.chatTheme) private var chatTheme
    let attachment: NativeLiveComposerAttachmentDraft
    let onRemove: () -> Void
    let onRetry: () -> Void

    @ViewBuilder var body: some View {
        if chatTheme == .iMessage {
            iMessageBody
        } else {
            originalBody
        }
    }

    // The original chip's layout, status labels and actions are unchanged.
    private var originalBody: some View {
        HStack(spacing: 7) {
            NativeLiveComposerMediaThumbnail(attachment:attachment)
                .frame(width:44,height:44).clipShape(RoundedRectangle(cornerRadius:8))

            Text(attachment.presentationInput.filename)
                .font(.system(size: 12.5, weight: .medium))
                .lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: 150, alignment: .leading)

            switch attachment.state {
            case .uploading:
                ProgressView()
                    .controlSize(.mini)

            case .ready:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)

            case .failed:
                Text("Upload failed").font(.caption2).foregroundStyle(.secondary)
                Button {
                    onRetry()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Retry upload")
            }

            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove attachment")
        }
        .padding(.leading, 10)
        .padding(.trailing, 5)
        .frame(height: 54)
        .background(
            Color.chatSoftFill,
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
    }

    // The same native regular glass as the iMessage input capsule.
    // A failed attachment's preview itself is the retry action.
    private var iMessageBody: some View {
        HStack(spacing: 8) {
            Group {
                if case .failed = attachment.state {
                    Button(action: onRetry) {
                        iMessageAttachmentContent
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Retry upload")
                    .accessibilityHint("Retry uploading \(attachment.presentationInput.filename)")
                } else {
                    iMessageAttachmentContent
                }
            }

            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 30, height: 30)
                    .glassEffect(.regular, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove attachment")
        }
        .padding(.leading, 6)
        .padding(.trailing, 7)
        .frame(height: 58)
        .glassEffect(
            .regular,
            in: RoundedRectangle(cornerRadius: 13, style: .continuous)
        )
    }

    private var iMessageAttachmentContent: some View {
        HStack(spacing: 8) {
            iMessageThumbnail
            VStack(alignment: .leading, spacing: 3) {
                Text(attachment.presentationInput.filename)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 125, alignment: .leading)

                switch attachment.state {
                case .uploading:
                    Text("Uploading…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                case .ready:
                    EmptyView()
                case .failed:
                    Text("Upload failed · Retry")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var iMessageThumbnail: some View {
        ZStack {
            NativeLiveComposerMediaThumbnail(attachment: attachment)
                .frame(width: 44, height: 44)
                .background(
                    Color.primary.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

            switch attachment.state {
            case .uploading:
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color.black.opacity(0.42))
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
                    .accessibilityHidden(true)
            case .ready:
                EmptyView()
            case .failed:
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(Color.black.opacity(0.42))
                Image(systemName: "exclamationmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 44, height: 44)
        .accessibilityElement(children: .ignore)
    }
}

private struct NativeLiveComposerMediaThumbnail: View {
    @EnvironmentObject private var appModel: AppModel
    let attachment: NativeLiveComposerAttachmentDraft
    @StateObject private var loader = NativeLiveMediaLoadState()
    var body: some View {
        let input = attachment.presentationInput
        Group {
            if let image = loader.image { Image(uiImage:image).resizable().scaledToFill() }
            else { Image(systemName:input.mediaKind == .bitmap ? "photo" : (input.mediaKind == .svg ? "photo.artframe" : "doc")) }
        }
        .task(id:"\(input.draftID)|\(input.materialization)") {
            guard input.mediaKind == .bitmap else { return }
            await loader.load(input,appModel:appModel,pixels:128,draftData:attachment.data)
        }
    }
}
