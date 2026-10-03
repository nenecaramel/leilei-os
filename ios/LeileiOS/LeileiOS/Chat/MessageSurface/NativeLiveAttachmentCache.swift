import Foundation
import CryptoKit

struct NativeLiveAttachmentCacheKey: Hashable, Sendable {
    let scope: String
    let attachmentID: String
    let sizeBytes: Int
    let sha256: String
    var imageKey: String { "\(scope)|\(attachmentID)|\(sizeBytes)|\(sha256)" }
}

enum NativeLiveAttachmentIntegrity {
    static func sha256(_ data: Data) -> String { SHA256.hash(data:data).map { String(format:"%02x",$0) }.joined() }
    static func verify(_ data: Data, key: NativeLiveAttachmentCacheKey) throws {
        guard data.count == key.sizeBytes, sha256(data) == key.sha256 else { throw NativeLiveMediaError.integrityFailed }
    }
}

// Original bytes are independent of decode size. Failures are never cached.
actor NativeLiveAttachmentBytesCache {
    private let limit: Int
    private let diskRoot: URL?
    private let diskLimit: Int
    private var bytesByKey: [NativeLiveAttachmentCacheKey:Data] = [:]
    private var order: [NativeLiveAttachmentCacheKey] = []
    private var inFlight: [NativeLiveAttachmentCacheKey:Task<Data,Error>] = [:]
    init(limit: Int = 64 * 1024 * 1024, diskRoot: URL? = nil, diskLimit: Int = 256 * 1024 * 1024) {
        self.limit = limit; self.diskRoot = diskRoot; self.diskLimit = diskLimit
    }

    func bytes(key: NativeLiveAttachmentCacheKey, fetch: @escaping @Sendable () async throws -> Data) async throws -> Data {
        if let data = bytesByKey[key] { touch(key); return data }
        if let data = try readDisk(key) { storeMemory(data,key:key); return data }
        if let task = inFlight[key] { return try await task.value }
        let task = Task {
            let data = try await fetch()
            try NativeLiveAttachmentIntegrity.verify(data,key:key)
            return data
        }
        inFlight[key] = task
        do {
            let data = try await task.value
            inFlight[key] = nil
            store(data,key:key)
            return data
        } catch { inFlight[key] = nil; throw error }
    }
    func seed(_ data: Data, key: NativeLiveAttachmentCacheKey) throws {
        try NativeLiveAttachmentIntegrity.verify(data,key:key)
        store(data,key:key)
    }
    private func touch(_ key: NativeLiveAttachmentCacheKey) { order.removeAll { $0 == key }; order.append(key) }
    private func store(_ data: Data,key: NativeLiveAttachmentCacheKey) {
        if let diskRoot, data.count <= diskLimit {
            do {
                try FileManager.default.createDirectory(at:diskRoot,withIntermediateDirectories:true)
                try data.write(to:diskFile(key,root:diskRoot),options:.atomic)
                pruneDisk()
            } catch { /* Optional cache IO failure does not invalidate verified bytes. */ }
        }
        storeMemory(data,key:key)
    }
    private func storeMemory(_ data: Data,key: NativeLiveAttachmentCacheKey) {
        guard data.count <= limit else { return }
        bytesByKey[key] = data; touch(key)
        while bytesByKey.values.reduce(0,{ $0 + $1.count }) > limit, let oldest = order.first {
            bytesByKey[oldest] = nil; order.removeFirst()
        }
    }
    private func diskFile(_ key:NativeLiveAttachmentCacheKey,root:URL) -> URL {
        root.appendingPathComponent(NativeLiveAttachmentIntegrity.sha256(Data(key.imageKey.utf8)))
    }
    private func readDisk(_ key:NativeLiveAttachmentCacheKey) throws -> Data? {
        guard let diskRoot else { return nil }
        let file = diskFile(key,root:diskRoot)
        guard FileManager.default.fileExists(atPath:file.path) else { return nil }
        do {
            let info = try file.resourceValues(forKeys:[.fileSizeKey,.isRegularFileKey])
            guard info.isRegularFile == true, info.fileSize == key.sizeBytes else { throw NativeLiveMediaError.integrityFailed }
            let data = try Data(contentsOf:file)
            try NativeLiveAttachmentIntegrity.verify(data,key:key)
            try? FileManager.default.setAttributes([.modificationDate:Date()],ofItemAtPath:file.path)
            return data
        } catch {
            try? FileManager.default.removeItem(at:file)
            if error is NativeLiveMediaError { throw error }
            return nil
        }
    }
    private func pruneDisk() {
        guard let diskRoot, let files = try? FileManager.default.contentsOfDirectory(at:diskRoot,
                includingPropertiesForKeys:[.fileSizeKey,.contentModificationDateKey,.isRegularFileKey]) else { return }
        let records = files.compactMap { file -> (URL,Int,Date)? in
            guard file.lastPathComponent.count == 64, file.lastPathComponent.allSatisfy({ $0.isHexDigit }),
                  let info = try? file.resourceValues(forKeys:[.fileSizeKey,.contentModificationDateKey,.isRegularFileKey]),
                  info.isRegularFile == true else { return nil }
            return (file,info.fileSize ?? 0,info.contentModificationDate ?? .distantPast)
        }.sorted { $0.2 < $1.2 }
        var total = records.reduce(0) { $0 + $1.1 }
        for (file,size,_) in records where total > diskLimit {
            try? FileManager.default.removeItem(at:file); total -= size
        }
    }

}

struct NativeLiveLoadedAttachment: Sendable {
    let data: Data
    let key: NativeLiveAttachmentCacheKey
}

extension NativeLiveChatAttachmentSnapshot {
    var presentationMetadata: [String:NativeLiveJSONValue] {
        ["attachment_id":.string(attachmentId),"filename":.string(filename),"mime_type":.string(mimeType),
         "kind":.string(kind.rawValue),"size_bytes":.number(Double(sizeBytes)),"sha256":.string(sha256),
         "storage":.string("native_live_attachment")]
    }
}

// HTTP caching is disabled: only integrity-verified bytes enter the reusable cache.
enum NativeLiveMediaTransport {
    static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration:configuration)
    }()
}
