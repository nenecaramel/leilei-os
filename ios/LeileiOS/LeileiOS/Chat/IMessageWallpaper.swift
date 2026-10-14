import Foundation
import UIKit

/// One device-local wallpaper shared by every iMessage-style conversation.
/// The image is never uploaded or attached to a chat message.
@MainActor
enum IMessageWallpaper {
    static let revisionKey = "chat.imessage.wallpaperRevision"

    private static let filename = "wallpaper.jpg"
    private static let maximumDimension: CGFloat = 2400

    private static func imageURL() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = support.appendingPathComponent("iMessageWallpaper", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory.appendingPathComponent(filename)
    }

    static func load() -> UIImage? {
        guard let url = try? imageURL() else { return nil }
        return UIImage(contentsOfFile: url.path)
    }

    static func save(_ image: UIImage) throws {
        // Bound storage size and memory cost; draw also normalizes EXIF
        // orientation so center-cropped display looks the same after relaunch.
        let longest = max(image.size.width, image.size.height)
        guard longest > 0 else { throw WallpaperError.invalidImage }
        let scale = min(1, maximumDimension / longest)
        let size = CGSize(
            width: max(1, (image.size.width * scale).rounded()),
            height: max(1, (image.size.height * scale).rounded())
        )
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let jpeg = UIGraphicsImageRenderer(size: size, format: format)
            .jpegData(withCompressionQuality: 0.86) { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        try jpeg.write(to: imageURL(), options: .atomic)
    }

    static func remove() throws {
        let url = try imageURL()
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    enum WallpaperError: LocalizedError {
        case invalidImage

        var errorDescription: String? {
            switch self {
            case .invalidImage: "The selected photo could not be opened."
            }
        }
    }
}
