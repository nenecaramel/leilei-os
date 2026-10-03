import Foundation

@MainActor final class AppModel {
    var isAuthenticated = true
    var accountEmail: String? = "test-user"
    let config: TestConfig
    let api: TestAPI
    let nativeLiveAttachmentBytesCache = NativeLiveAttachmentBytesCache()
    init(url:URL) { config = .init(apiBaseURL:url); api = .init(base:url) }
}
struct TestConfig { let apiBaseURL:URL }
@MainActor final class TestAPI {
    let base:URL
    var overrideIdentity: String?
    init(base:URL) { self.base = base }
    func nativeLiveAttachmentDownloadSlot(attachmentID:String) async throws -> NativeLiveAttachmentDownloadSlot {
        let data = Data("verified content".utf8)
        let attachment = NativeLiveChatAttachmentSnapshot(attachmentId:overrideIdentity ?? attachmentID,filename:"file.bin",mimeType:"application/octet-stream",sizeBytes:data.count,sha256:NativeLiveAttachmentIntegrity.sha256(data),kind:.file,status:"ready",boundMessageId:nil,createdAt:"",expiresAt:"")
        return .init(attachment:attachment,download:.init(url:base.appendingPathComponent(attachmentID).absoluteString,method:"GET",headers:["x-media-slot":"capability"],expiresAt:""))
    }
}
@main struct TransportChecks {
    @MainActor static func main() async throws {
        let app = AppModel(url:URL(string:CommandLine.arguments[1])!)
        func input(_ id:String) -> NativeLiveAttachmentPresentationInput {
            .init(entityID:id,draftID:id,filename:"file.bin",mimeType:"application/octet-stream",kind:"file",materialization:"ready")
        }
        for _ in 0..<3 { let loaded = try await app.nativeLiveAttachmentBytes(input("valid")); precondition(loaded.data == Data("verified content".utf8)) }
        for id in ["size","sha"] {
            do { _ = try await app.nativeLiveAttachmentBytes(input(id)); preconditionFailure("bad bytes shown") }
            catch let error as NativeLiveMediaError { precondition(error == .integrityFailed) }
            // Broken originals were never reusable; next network attempt can recover.
            _ = try await app.nativeLiveAttachmentBytes(input(id))
        }
        do { _ = try await app.nativeLiveAttachmentBytes(input("retry")); preconditionFailure() }
        catch let error as NativeLiveMediaError { precondition(error == .downloadFailed) }
        _ = try await app.nativeLiveAttachmentBytes(input("retry"))
        app.api.overrideIdentity = "different"
        do { _ = try await app.nativeLiveAttachmentBytes(input("wrong")); preconditionFailure() }
        catch let error as NativeLiveMediaError { precondition(error == .unavailable) }
        app.api.overrideIdentity = nil
        app.isAuthenticated = false
        do { _ = try await app.nativeLiveAttachmentBytes(input("valid")); preconditionFailure() }
        catch let error as NativeLiveMediaError { precondition(error == .unavailable) }
        print("Media transport PASS")
    }
}
