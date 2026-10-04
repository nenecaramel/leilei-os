import Foundation
import UniformTypeIdentifiers

nonisolated enum NativeLivePreviewFilename {
    static func safe(_ filename: String, mimeType: String) -> String {
        let cleaned = filename.replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"\\",with:"_")
            .components(separatedBy:.controlCharacters).joined().trimmingCharacters(in:.whitespacesAndNewlines)
        let name = cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "Attachment" : cleaned
        let ext = (name as NSString).pathExtension
        let suggested = ext.isEmpty ? (UTType(mimeType:mimeType)?.preferredFilenameExtension ?? "") : ext
        let suffix = suggested.isEmpty ? "" : "." + String(suggested.prefix(32))
        let stem = ext.isEmpty ? name : (name as NSString).deletingPathExtension
        // Bound UTF-8 bytes to stay under filesystem NAME_MAX, preserving extension.
        var bounded = String(stem.prefix(160))
        while bounded.utf8.count + suffix.utf8.count > 220 { bounded.removeLast() }
        return bounded + suffix
    }
}

nonisolated final class NativeLiveFilePreviewLease: Identifiable {
    static let defaultRoot: URL = {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("LeileiOS-MediaPreview",isDirectory:true)
        // Only this app-owned preview area; recover from previews interrupted by process exit.
        try? FileManager.default.removeItem(at:root)
        return root
    }()
    let id = UUID()
    let fileURL: URL
    private let directory: URL
    init(data: Data, filename: String, mimeType: String, root: URL = NativeLiveFilePreviewLease.defaultRoot) throws {
        directory = root.appendingPathComponent(UUID().uuidString,isDirectory:true)
        fileURL = directory.appendingPathComponent(NativeLivePreviewFilename.safe(filename,mimeType:mimeType))
        do {
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            try data.write(to:fileURL,options:.atomic)
        } catch { try? FileManager.default.removeItem(at:directory); throw NativeLiveMediaError.previewFailed }
    }
    func cleanup() { try? FileManager.default.removeItem(at:directory) }
    deinit { cleanup() }
}
