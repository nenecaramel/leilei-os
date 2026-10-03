import Foundation
import UniformTypeIdentifiers

enum NativeLiveAttachmentSource: String, Sendable { case authoritative, draft, retainedEdit, providerCandidate }
enum NativeLiveMediaKind: Sendable { case bitmap, svg, file }
enum NativeLiveMediaState: String, Sendable { case uploading, ready, loading, loaded, failed, integrityFailed = "integrity_failed", unavailable }

enum NativeLiveMediaError: Error, LocalizedError, Equatable {
    case unavailable, downloadFailed, integrityFailed, previewFailed, decodeFailed
    var state: NativeLiveMediaState {
        switch self { case .unavailable: return .unavailable; case .integrityFailed: return .integrityFailed; default: return .failed }
    }
    var errorDescription: String? {
        switch self {
        case .unavailable: return "Attachment unavailable. Try again."
        case .downloadFailed: return "Download failed. Try again."
        case .integrityFailed: return "Attachment integrity check failed. Try again."
        case .previewFailed: return "Could not prepare this file for preview. Try again."
        case .decodeFailed: return "Image preview unavailable. Open as a file."
        }
    }
}

extension NativeLiveAttachmentPresentationInput {
    var sizeBytes: Int? {
        guard let n = metadata["size_bytes"]?.numberValue, n.isFinite, n >= 0, n.rounded() == n, n < Double(Int.max) else { return nil }
        return Int(n)
    }
    var sha256: String? { metadata["sha256"]?.stringValue?.lowercased() }
    var mediaKind: NativeLiveMediaKind {
        let mime = mimeType.split(separator:";",maxSplits:1).first.map(String.init)?.lowercased() ?? mimeType.lowercased()
        let ext = (filename as NSString).pathExtension.lowercased()
        if mime == "image/svg+xml" || ext == "svg" { return .svg }
        let mimeType = UTType(mimeType:mime)
        let extensionType = UTType(filenameExtension:ext)
        if mimeType?.conforms(to:.image) == true || extensionType?.conforms(to:.image) == true || kind == "image" { return .bitmap }
        return .file
    }
    var stillPreviewLabel: String? {
        let mime = mimeType.lowercased()
        return mime == "image/gif" || mime == "image/webp" ? "Still preview" : nil
    }
    var presentationState: NativeLiveMediaState {
        switch materialization {
        case "uploading", "pending": return .uploading
        case "ready": return .ready
        case "loaded": return .loaded
        case "failed": return .failed
        case "integrity_failed": return .integrityFailed
        default: return .unavailable
        }
    }
    func cacheKey(scope: String) throws -> NativeLiveAttachmentCacheKey {
        guard let entityID, !entityID.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,
              let sizeBytes, let sha256, sha256.count == 64, sha256.allSatisfy({ $0.isHexDigit && $0.isASCII }) else { throw NativeLiveMediaError.unavailable }
        return .init(scope:scope,attachmentID:entityID,sizeBytes:sizeBytes,sha256:sha256)
    }
}

// Geometry is shared by all source phases; only available width and image count vary.
struct NativeLiveMediaLayout {
    let visibleCount: Int
    let columns: Int
    let tileWidth: Double
    let tileHeight: Double
    init(count: Int, availableWidth: Double, aspectRatio: Double = 1) {
        visibleCount = min(max(count,0),4)
        columns = count == 1 ? 1 : 2
        let width = max(1, availableWidth.isFinite ? availableWidth : 1)
        tileWidth = max(1,(width - Double(columns-1)*6)/Double(columns))
        let ratio = aspectRatio.isFinite && aspectRatio > 0 ? min(3,max(0.75,aspectRatio)) : 1
        tileHeight = count == 1 ? min(width,max(min(120,width),tileWidth/ratio)) : tileWidth
    }
}

extension NativeLiveMessagePresentation {
    var mediaNodes: [NativeLiveVisualNode] { nodes.filter { $0.attachment != nil } }
    var textNodes: [NativeLiveVisualNode] { nodes.filter { $0.canonicalIdentity == "text" } }
    var nonTextBodyNodes: [NativeLiveVisualNode] { bodyNodes.filter { $0.canonicalIdentity != "text" } }
    var bodyNodes: [NativeLiveVisualNode] { nodes.filter { $0.attachment == nil } }
}

enum NativeLiveMediaRetryPolicy {
    enum Action { case loadImage, openFile }
    static func action(kind:NativeLiveMediaKind,previewFailed:Bool) -> Action {
        previewFailed || kind != .bitmap ? .openFile : .loadImage
    }
}

struct NativeLiveGallerySelection: Identifiable {
    let id = UUID()
    let inputs: [NativeLiveAttachmentPresentationInput]
    let selectedID: String
    var selectedIndex: Int { inputs.firstIndex { ($0.entityID ?? $0.draftID) == selectedID } ?? 0 }
}

enum NativeLiveMediaSequence {
    static func groups(_ inputs:[NativeLiveAttachmentPresentationInput]) -> [[NativeLiveAttachmentPresentationInput]] {
        var result = [[NativeLiveAttachmentPresentationInput]]()
        for input in inputs {
            if input.mediaKind == .bitmap, result.last?.first?.mediaKind == .bitmap { result[result.count-1].append(input) }
            else { result.append([input]) }
        }
        return result
    }
}
