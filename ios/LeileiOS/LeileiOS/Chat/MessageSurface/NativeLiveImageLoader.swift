import Foundation
import ImageIO
import CoreGraphics

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
    func decode(_ data: Data, identity: String, maxPixelSize: Int) throws -> NativeLiveDecodedImage {
        let pixels = min(4096,max(32,maxPixelSize))
        let key = "\(identity)|\(pixels)" as NSString
        if let cached = cache.object(forKey:key) { return cached }
        guard let source = CGImageSourceCreateWithData(data as CFData,[kCGImageSourceShouldCache:false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source,0,[
                kCGImageSourceCreateThumbnailFromImageAlways:true,
                kCGImageSourceCreateThumbnailWithTransform:true,
                kCGImageSourceThumbnailMaxPixelSize:pixels,
                kCGImageSourceShouldCacheImmediately:true
              ] as CFDictionary) else { throw NativeLiveMediaError.decodeFailed }
        let result = NativeLiveDecodedImage(image)
        cache.setObject(result,forKey:key,cost:image.bytesPerRow*image.height)
        return result
    }
}
