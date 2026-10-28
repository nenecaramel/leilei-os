import Foundation
import CryptoKit
import ImageIO
import CoreGraphics

@main struct MediaChecks {
    static func main() async throws {
        let bytes = Data("verified content".utf8)
        let sha = NativeLiveAttachmentIntegrity.sha256(bytes)
        let payload: [String: NativeLiveJSONValue] = ["attachment_id": .string("owned"), "filename": .string("photo.PNG"), "mime_type": .string("image/png"), "size_bytes": .number(Double(bytes.count)), "sha256": .string(sha), "storage": .string("native_live_attachment"), "provenance": .object(["origin": .string("provider_send")]), "refs": .array([.object(["type": .string("attachment_ref"), "entity_id": .string("owned")])]), "extra": .object(["future": .bool(true)])]
        let block = NativeLiveCurrentPathBlock(id:"b1",ordinal:1,kind:"attachment",rawType:"image",text:nil,payload:payload,createdAt:"")
        let input = NativeLiveAttachmentPresentationInput(block:block)
        precondition(input.sizeBytes == bytes.count && input.sha256 == sha && input.metadata == payload)
        precondition(input.mediaKind == .bitmap && input.source == .authoritative)
        precondition(input.retainedComposerDraft?.presentationInput.metadata == payload)
        let message = NativeLiveCurrentPathMessage(id:"m",conversationId:"c",parentMessageId:nil,role:"user",status:"completed",createdAt:"",completedAt:nil,blocks:[block])
        let only = NativeLiveMessagePresentationProjector.project(.canonical(message))
        precondition(only.bodyNodes.isEmpty && only.mediaNodes.count == 1)
        let text = NativeLiveCurrentPathBlock(id:"text",ordinal:0,kind:"text",rawType:"text",text:"hello",payload:["input_mode":.string("voice")],createdAt:"")
        let mixed = NativeLiveMessagePresentationProjector.project(.canonical(.init(id:"m",conversationId:"c",parentMessageId:nil,role:"user",status:"completed",createdAt:"",completedAt:nil,blocks:[block,text])))
        precondition(mixed.bodyNodes.count == 1 && mixed.mediaNodes.count == 1 && mixed.isVoiceInput)
        let draft = NativeLiveMessagePresentationProjector.project(.send(messageID:"draft",text:"hello",attachments:[input]))
        precondition(draft.attachmentInputs.map(\.entityID) == mixed.attachmentInputs.map(\.entityID))
        let edited = NativeLiveMessagePresentationProjector.project(.edit(message,text:"edit",attachments:[input]))
        precondition(edited.attachmentInputs[0].metadata == payload)
        precondition(edited.attachmentInputs[0].source == .retainedEdit)
        let local = NativeLiveComposerAttachmentDraft(filename:"local.png",mimeType:"image/png",kind:.image,data:bytes)
        precondition(NativeLiveMessagePresentationProjector.project(.send(messageID:"local",text:"",attachments:[local.presentationInput])).attachmentInputs[0].source == .draft)
        precondition(NativeLiveMessagePresentationProjector.project(.edit(message,text:"",attachments:[])).mediaNodes.isEmpty)
        for mime in ["image/jpeg","image/png","image/gif","image/webp","image/heic","image/heif"] {
            let media = NativeLiveAttachmentPresentationInput(entityID:"id",draftID:"d",filename:"image",mimeType:mime,kind:"file",materialization:"ready")
            precondition(media.mediaKind == .bitmap)
        }
        let memeSticker = NativeLiveAttachmentPresentationInput(entityID:"meme",draftID:"meme",filename:"meme_0003.webp",mimeType:"image/webp",kind:"image",materialization:"ready")
        precondition(memeSticker.isMemeSticker)
        precondition(!NativeLiveAttachmentPresentationInput(entityID:"meme",draftID:"meme",filename:"meme_003.webp",mimeType:"image/webp",kind:"image",materialization:"ready").isMemeSticker)
        precondition(!NativeLiveAttachmentPresentationInput(entityID:"meme",draftID:"meme",filename:"meme_0003.png",mimeType:"image/png",kind:"image",materialization:"ready").isMemeSticker)
        precondition(!NativeLiveAttachmentPresentationInput(entityID:"meme",draftID:"meme",filename:"other_0003.webp",mimeType:"image/webp",kind:"image",materialization:"ready").isMemeSticker)
        precondition(NativeLiveAttachmentPresentationInput(entityID:"id",draftID:"d",filename:"art.svg",mimeType:"image/svg+xml",kind:"image",materialization:"ready").mediaKind == .svg)
        precondition(NativeLiveAttachmentPresentationInput(entityID:"id",draftID:"d",filename:"x.dat",mimeType:"application/x-future",kind:"file",materialization:"ready").mediaKind == .file)
        let name = String(repeating:"x",count:300) + ".pdf"
        precondition(NativeLivePreviewFilename.safe(name,mimeType:"application/pdf").hasSuffix(".pdf"))
        for count in 1...7 {
            let layout = NativeLiveMediaLayout(count:count,availableWidth:196)
            precondition(layout.visibleCount == min(count,4) && layout.columns == (count == 1 ? 1 : 2))
            precondition(layout.tileWidth > 0 && layout.tileWidth <= 196 && layout.tileHeight <= 196)
        }
        // One image is one tile of the two-column grid, not the whole row; the
        // grid then occupies only that tile so the message alignment places it.
        for width in [196.0, 360.0] {
            let single = NativeLiveMediaLayout(count:1,availableWidth:width)
            let pair = NativeLiveMediaLayout(count:2,availableWidth:width)
            precondition(single.tileWidth == pair.tileWidth && single.tileHeight == pair.tileHeight)
            precondition(single.occupiedWidth == single.tileWidth && pair.occupiedWidth == width)
        }
        let cache = NativeLiveAttachmentBytesCache(limit:1024)
        let counter = Counter()
        let key = try input.cacheKey(scope:"account")
        async let a = cache.bytes(key:key) { await counter.increment(); return bytes }
        async let b = cache.bytes(key:key) { await counter.increment(); return bytes }
        _ = try await (a,b)
        let fetched = await counter.value
        precondition(fetched == 1)
        for invalid in [Data(),Data("same-sized-bad!!".utf8)] {
            do { _ = try await cache.bytes(key: .init(scope:"account",attachmentID:"bad",sizeBytes:bytes.count,sha256:sha)) { invalid }; preconditionFailure("bad integrity accepted") }
            catch let error as NativeLiveMediaError { precondition(error.state == .integrityFailed) }
        }
        let retryKey = NativeLiveAttachmentCacheKey(scope:"account",attachmentID:"retry",sizeBytes:bytes.count,sha256:sha)
        do { _ = try await cache.bytes(key:retryKey) { throw NativeLiveMediaError.downloadFailed }; preconditionFailure() } catch {}
        let retry = try await cache.bytes(key:retryKey) { bytes }
        precondition(retry == bytes)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let preview = try NativeLiveFilePreviewLease(data:bytes,filename:name,mimeType:"application/pdf",root:root)
        precondition(FileManager.default.fileExists(atPath:preview.fileURL.path) && preview.fileURL.pathExtension == "pdf")
        preview.cleanup()
        precondition(!FileManager.default.fileExists(atPath:preview.fileURL.path))
        try? FileManager.default.removeItem(at:root)
        // Actual ImageIO decoding/downsampling, sharing a single original-byte fetch.
        let image = CGContext(data:nil,width:4000,height:256,bitsPerComponent:8,bytesPerRow:0,
                              space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue)!.makeImage()!
        func encode(_ type:String) throws -> Data {
            let result = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(result,type as CFString,1,nil) else { throw NativeLiveMediaError.decodeFailed }
            CGImageDestinationAddImage(destination,image,nil)
            guard CGImageDestinationFinalize(destination) else { throw NativeLiveMediaError.decodeFailed }
            return result as Data
        }
        let decoder = NativeLiveImageDecoder()
        for type in ["public.png","public.jpeg","com.compuserve.gif","public.heic"] {
            FileHandle.standardError.write(Data("Checking \(type)\n".utf8))
            let encoded = try encode(type)
            FileHandle.standardError.write(Data("Encoded \(encoded.count) bytes\n".utf8))
            let decoded = try await decoder.decode(encoded,identity:type,maxPixelSize:128)
            precondition(decoded.image.width <= 128 && decoded.image.height <= 128)
        }
        let webp = Data(base64Encoded:"UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAIAAUAmJaQAA3AA/vz0AAA=")!
        FileHandle.standardError.write(Data("Checking webp\n".utf8))
        let webpImage = try await decoder.decode(webp,identity:"webp",maxPixelSize:128)
        precondition(webpImage.image.width == 2)
        do { _ = try await decoder.decode(Data("not an image".utf8),identity:"invalid",maxPixelSize:100); preconditionFailure() }
        catch let error as NativeLiveMediaError { precondition(error == .decodeFailed) }
        let png = try encode("public.png")
        let downloads = Counter()
        let originalCache = NativeLiveAttachmentBytesCache()
        let originalKey = NativeLiveAttachmentCacheKey(scope:"user",attachmentID:"png",sizeBytes:png.count,sha256:NativeLiveAttachmentIntegrity.sha256(png))
        for target in [128,1024,3072] {
            let original = try await originalCache.bytes(key:originalKey) { await downloads.increment(); return png }
            let decoded = try await decoder.decode(original,identity:originalKey.imageKey,maxPixelSize:target)
            precondition(max(decoded.image.width,decoded.image.height) <= target)
        }
        let downloadCount = await downloads.value
        precondition(downloadCount == 1)
        let same = try await decoder.decode(png,identity:originalKey.imageKey,maxPixelSize:128)
        let again = try await decoder.decode(png,identity:originalKey.imageKey,maxPixelSize:128)
        precondition(same === again)
        let failedNew = NativeLiveComposerAttachmentDraft(filename:"broken.png",mimeType:"image/png",kind:.image,data:png,state:.failed("upload"))
        precondition(failedNew.presentationInput.entityID == nil && failedNew.presentationInput.retainedComposerDraft == nil)
        let new = NativeLiveComposerAttachmentDraft(filename:"new.png",mimeType:"image/png",kind:.image,data:png,state:.ready("new"))
        let added = NativeLiveMessagePresentationProjector.project(.edit(message,text:"",attachments:[input,new.presentationInput]))
        precondition(added.attachmentInputs.map(\.entityID) == ["owned","new"] && added.mediaNodes.map(\.ordinal) == [0,1])
        let subset = NativeLiveMessagePresentationProjector.project(.edit(message,text:"",attachments:[new.presentationInput]))
        precondition(subset.attachmentInputs.map(\.entityID) == ["new"])
        let voiceOnly = NativeLiveMessagePresentationProjector.project(.send(messageID:"voice",text:"transcript",inputMode:.voice))
        precondition(voiceOnly.isVoiceInput && voiceOnly.mediaNodes.isEmpty)
        let blockedRoot = root.appendingPathComponent("block")
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        try Data().write(to:blockedRoot)
        do { _ = try NativeLiveFilePreviewLease(data:bytes,filename:"a.pdf",mimeType:"application/pdf",root:blockedRoot); preconditionFailure() }
        catch let error as NativeLiveMediaError { precondition(error == .previewFailed) }
        try? FileManager.default.removeItem(at:root)
        let file = NativeLiveAttachmentPresentationInput(entityID:"file",draftID:"file",filename:"a.pdf",mimeType:"application/pdf",kind:"file",materialization:"ready")
        let grouped = NativeLiveMediaSequence.groups([input,file,input])
        precondition(grouped.map(\.count) == [1,1,1] && grouped.flatMap { $0 }.map(\.entityID) == ["owned","file","owned"])
        let galleryItems = (0..<7).map { NativeLiveAttachmentPresentationInput(entityID:"image-\($0)",draftID:"d-\($0)",filename:"a.png",mimeType:"image/png",kind:"image",materialization:"ready") }
        let gallery = NativeLiveGallerySelection(inputs:galleryItems,selectedID:"image-4")
        precondition(gallery.selectedIndex == 4 && gallery.inputs.count == 7)
        precondition(NativeLiveMediaRetryPolicy.action(kind:.file,previewFailed:true) == .openFile)
        precondition(NativeLiveMediaRetryPolicy.action(kind:.svg,previewFailed:true) == .openFile)
        precondition(NativeLiveMediaRetryPolicy.action(kind:.bitmap,previewFailed:true) == .openFile)
        precondition(NativeLiveMediaRetryPolicy.action(kind:.bitmap,previewFailed:false) == .loadImage)
        let diskRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let diskCache = NativeLiveAttachmentBytesCache(limit:1,diskRoot:diskRoot,diskLimit:1024)
        let diskCounter = Counter()
        for _ in 0..<2 { _ = try await diskCache.bytes(key:key) { await diskCounter.increment(); return bytes } }
        let diskCount = await diskCounter.value
        precondition(diskCount == 1, "memory eviction must not force an original download")
        let corruptPath = diskRoot.appendingPathComponent(NativeLiveAttachmentIntegrity.sha256(Data(key.imageKey.utf8)))
        try Data().write(to:corruptPath)
        do { _ = try await diskCache.bytes(key:key) { bytes }; preconditionFailure("corrupt disk cache reused") }
        catch let error as NativeLiveMediaError { precondition(error == .integrityFailed) }
        _ = try await diskCache.bytes(key:key) { bytes }
        try? FileManager.default.removeItem(at:diskRoot)
        print("Media foundation PASS")
    }
}
actor Counter { var value = 0; func increment() { value += 1 } }
