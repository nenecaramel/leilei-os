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
    let attachment: NativeLiveComposerAttachmentDraft
    let onRemove: () -> Void
    let onRetry: () -> Void

    var body: some View {
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
