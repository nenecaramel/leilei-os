import Foundation
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

extension ChatView {
    func addAttachment(
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

    func retryAttachmentUpload(_ id: UUID) {
        guard let index = composerAttachments.firstIndex(
            where: { $0.id == id }
        ),
        composerAttachments[index].data != nil else {
            return
        }
        composerAttachments[index].state = .uploading
        uploadAttachment(id)
    }

    func uploadAttachment(_ id: UUID) {
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
                composerAttachments[index].presentationMetadata = ready.presentationMetadata
                composerAttachments[index].state = .ready(ready.attachmentId)
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

    func importPhotos(
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

    func importFiles(
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
}
