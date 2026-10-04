import Foundation
import CryptoKit

extension AppModel {
    func nativeLiveAttachmentBytes(_ input: NativeLiveAttachmentPresentationInput) async throws -> NativeLiveLoadedAttachment {
        guard isAuthenticated, let id = input.entityID else { throw NativeLiveMediaError.unavailable }
        let account = accountEmail
        let scope = config.apiBaseURL.absoluteString + "|" + (account ?? "authenticated")

        // Reuse already-verified original bytes before asking the backend for
        // another short-lived download capability. Gallery / inline / file
        // preview must share the same attachment cache.
        if let canonicalKey = try? input.cacheKey(scope:scope),
           let cached = try await nativeLiveAttachmentBytesCache.cached(
               key:canonicalKey
           ) {
            guard isAuthenticated, accountEmail == account else {
                throw NativeLiveMediaError.unavailable
            }
            return .init(data:cached,key:canonicalKey)
        }

        let slot = try await api.nativeLiveAttachmentDownloadSlot(attachmentID:id)
        guard slot.attachment.attachmentId == id, slot.download.method == "GET",
              let url = URL(string:slot.download.url), ["https", "http"].contains(url.scheme ?? "") else { throw NativeLiveMediaError.unavailable }
        if let size = input.sizeBytes, size != slot.attachment.sizeBytes { throw NativeLiveMediaError.integrityFailed }
        if let sha = input.sha256, sha != slot.attachment.sha256.lowercased() { throw NativeLiveMediaError.integrityFailed }
        let key = NativeLiveAttachmentCacheKey(scope:scope,attachmentID:id,sizeBytes:slot.attachment.sizeBytes,sha256:slot.attachment.sha256.lowercased())
        var request = URLRequest(url:url)
        request.httpMethod = slot.download.method
        request.timeoutInterval = 30
        for (name,value) in slot.download.headers { request.setValue(value,forHTTPHeaderField:name) }
        let downloadRequest = request
        let data = try await nativeLiveAttachmentBytesCache.bytes(key:key) {
            do {
                let (data,response) = try await NativeLiveMediaTransport.session.data(for:downloadRequest)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw NativeLiveMediaError.downloadFailed }
                return data
            } catch is CancellationError { throw CancellationError() }
            catch { throw NativeLiveMediaError.downloadFailed }
        }
        guard isAuthenticated, accountEmail == account else { throw NativeLiveMediaError.unavailable }
        return .init(data:data,key:key)
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

        let account = accountEmail
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
            let ready = try await api.completeNativeLiveAttachment(attachmentID: slot.attachment.attachmentId)
            guard isAuthenticated, accountEmail == account else { throw NativeLiveMediaError.unavailable }
            let key = NativeLiveAttachmentCacheKey(scope:config.apiBaseURL.absoluteString + "|" + (accountEmail ?? "authenticated"),
                attachmentID:ready.attachmentId,sizeBytes:ready.sizeBytes,sha256:ready.sha256.lowercased())
            try await nativeLiveAttachmentBytesCache.seed(data,key:key)
            return ready
        } catch {
            throw error
        }
    }
}
