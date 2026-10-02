import Foundation
import CryptoKit

extension AppModel {
    func nativeLiveAttachmentDownloadURL(
        attachmentID: String
    ) async -> URL? {
        guard isAuthenticated else { return nil }
        do {
            let slot =
                try await api.nativeLiveAttachmentDownloadSlot(
                    attachmentID: attachmentID
                )
            return URL(string: slot.download.url)
        } catch {
            return nil
        }
    }

    func uploadNativeLiveAttachment(
        data: Data,
        filename: String,
        mimeType: String,
        kind: NativeLiveComposerAttachmentKind
    ) async throws -> NativeLiveChatAttachmentSnapshot {
        guard isAuthenticated,
              !data.isEmpty,
              data.count <= 20 * 1024 * 1024 else {
            throw NativeLiveSendError.notReady
        }

        let digest = SHA256.hash(data: data)
        let sha256 = digest.map {
            String(format: "%02x", $0)
        }.joined()

        let slot =
            try await api.createNativeLiveAttachmentUploadSlot(
                filename: filename,
                mimeType: mimeType,
                sizeBytes: data.count,
                sha256: sha256,
                kind: kind
            )
        do {
            try await api.uploadNativeLiveAttachmentBytes(
                data,
                to: slot.upload
            )
            return try await api.completeNativeLiveAttachment(
                attachmentID: slot.attachment.attachmentId
            )
        } catch {
            throw error
        }
    }
}
