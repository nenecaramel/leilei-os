import Foundation
import ImageIO
import CoreGraphics
import QuickLookThumbnailing

nonisolated final class NativeLiveDecodedImage: @unchecked Sendable {
    let image: CGImage
    let aspectRatio: Double
    init(_ image: CGImage) { self.image = image; aspectRatio = Double(image.width)/Double(image.height) }
}

// ImageIO creates bounded thumbnails directly from compressed bytes, never a full decode first.
actor NativeLiveImageDecoder {
    static let shared = NativeLiveImageDecoder()
    private let cache = NSCache<NSString,NativeLiveDecodedImage>()
    init() { cache.totalCostLimit = 48 * 1024 * 1024; cache.countLimit = 64 }
    func decode(
        _ data: Data,
        identity: String,
        maxPixelSize: Int,
        filename: String = "Attachment",
        mimeType: String = "application/octet-stream"
    ) async throws -> NativeLiveDecodedImage {
        let pixels = min(4096,max(32,maxPixelSize))
        let key = "\(identity)|\(pixels)" as NSString
        if let cached = cache.object(forKey:key) { return cached }

        if let source = CGImageSourceCreateWithData(
            data as CFData,
            [kCGImageSourceShouldCache:false] as CFDictionary
        ), let image = CGImageSourceCreateThumbnailAtIndex(source,0,[
            kCGImageSourceCreateThumbnailFromImageAlways:true,
            kCGImageSourceCreateThumbnailWithTransform:true,
            kCGImageSourceThumbnailMaxPixelSize:pixels,
            kCGImageSourceShouldCacheImmediately:true
        ] as CFDictionary) {
            let result = NativeLiveDecodedImage(image)
            cache.setObject(
                result,
                forKey:key,
                cost:image.bytesPerRow*image.height
            )
            return result
        }

        let result = try await quickLookDecode(
            data,
            pixels:pixels,
            filename:filename,
            mimeType:mimeType
        )
        cache.setObject(
            result,
            forKey:key,
            cost:result.image.bytesPerRow*result.image.height
        )
        return result
    }

    private func quickLookDecode(
        _ data: Data,
        pixels: Int,
        filename: String,
        mimeType: String
    ) async throws -> NativeLiveDecodedImage {
        let lease = try NativeLiveFilePreviewLease(
            data:data,
            filename:filename,
            mimeType:mimeType
        )
        defer { lease.cleanup() }

        let request = QLThumbnailGenerator.Request(
            fileAt:lease.fileURL,
            size:CGSize(width:pixels,height:pixels),
            scale:1,
            representationTypes:.thumbnail
        )
        let image: CGImage = try await withCheckedThrowingContinuation {
            continuation in
            QLThumbnailGenerator.shared.generateBestRepresentation(
                for:request
            ) { representation, error in
                if let image = representation?.cgImage {
                    continuation.resume(returning:image)
                    return
                }
                continuation.resume(
                    throwing:error ?? NativeLiveMediaError.decodeFailed
                )
            }
        }
        guard image.width > 0, image.height > 0 else {
            throw NativeLiveMediaError.decodeFailed
        }
        return NativeLiveDecodedImage(image)
    }
}
