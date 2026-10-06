import SwiftUI
import Combine
import UIKit
import QuickLook

@MainActor final class NativeLiveMediaLoadState: ObservableObject {
    @Published var state: NativeLiveMediaState = .ready
    @Published var image: UIImage?
    @Published var error: String?
    func load(_ input: NativeLiveAttachmentPresentationInput, appModel: AppModel, pixels: Int, draftData: Data? = nil) async {
        state = .loading; error = nil; image = nil
        do {
            let data: Data
            let identity: String
            if let draftData {
                data = draftData
                identity = "draft:\(input.draftID)|\(input.sha256 ?? "")"
            } else {
                guard input.presentationState == .ready || input.presentationState == .loaded else {
                    state = input.presentationState; return
                }
                let loaded = try await appModel.nativeLiveAttachmentBytes(input)
                data = loaded.data; identity = loaded.key.imageKey
            }
            if input.mediaKind == .bitmap {
                let decoded: NativeLiveDecodedImage
                do {
                    decoded = try await NativeLiveImageDecoder.shared.decode(
                        data,
                        identity:identity,
                        maxPixelSize:pixels,
                        filename:input.filename,
                        mimeType:input.mimeType
                    )
                } catch is CancellationError {
                    throw CancellationError()
                } catch let failure as NativeLiveMediaError {
                    throw failure
                } catch {
                    throw NativeLiveMediaError.decodeFailed
                }
                try Task.checkCancellation()
                image = UIImage(cgImage:decoded.image)
            }
            state = .loaded
        } catch is CancellationError {} catch {
            let failure = error as? NativeLiveMediaError ?? .downloadFailed
            self.error = failure.localizedDescription; state = failure.state
        }
    }
}

struct NativeLiveMediaRenderer: View {
    let inputs: [NativeLiveAttachmentPresentationInput]
    @State private var gallery: NativeLiveGallerySelection?
    private var imageInputs: [NativeLiveAttachmentPresentationInput] { inputs.filter { $0.mediaKind == .bitmap } }
    private var groups: [[NativeLiveAttachmentPresentationInput]] {
        NativeLiveMediaSequence.groups(inputs)
    }

    var body: some View {
        VStack(alignment:.trailing,spacing:8) {
            ForEach(Array(groups.enumerated()),id:\.offset) { _, group in
                if group.first?.mediaKind == .bitmap {
                    if group.count == 1, let input = group.first, input.isMemeSticker {
                        NativeLiveMediaCard(input:input,stickerImage:true,onImageOpen:{
                            gallery = .init(inputs:imageInputs,selectedID:input.entityID ?? input.draftID)
                        })
                    } else {
                        NativeLiveMediaGrid(count:group.count) {
                            ForEach(Array(group.prefix(4).enumerated()),id:\.offset) { index,input in
                                NativeLiveMediaCard(input:input,compactImage:true,onImageOpen:{
                                    gallery = .init(inputs:imageInputs,selectedID:input.entityID ?? input.draftID)
                                })
                                .overlay(alignment:.bottomTrailing) {
                                    if index == 3 && group.count > 4 {
                                        Button {
                                            gallery = .init(inputs:imageInputs,selectedID:input.entityID ?? input.draftID)
                                        } label: {
                                            Text("+\(group.count-4) · View all").font(.caption.bold()).padding(8)
                                                .background(.ultraThinMaterial,in:Capsule())
                                        }.buttonStyle(.borderless).padding(6)
                                        .accessibilityLabel("View all \(imageInputs.count) images")
                                    }
                                }
                            }
                        }
                    }
                } else if let input = group.first { NativeLiveRegisteredAttachmentView(input:input) }
            }
        }
        .fullScreenCover(item:$gallery) { NativeLiveImageGallery(selection:$0) }
    }
}

struct NativeLiveMediaGrid: Layout {
    let count: Int
    func sizeThatFits(proposal:ProposedViewSize,subviews:Subviews,cache:inout ()) -> CGSize {
        let width = proposal.width ?? 320
        let policy = NativeLiveMediaLayout(count:count,availableWidth:width)
        let rows = ceil(Double(policy.visibleCount)/Double(policy.columns))
        return .init(width:width,height:rows*policy.tileHeight + max(0,rows-1)*6)
    }
    func placeSubviews(in bounds:CGRect,proposal:ProposedViewSize,subviews:Subviews,cache:inout ()) {
        let policy = NativeLiveMediaLayout(count:count,availableWidth:bounds.width)
        for (index,view) in subviews.enumerated() {
            view.place(at:.init(x:bounds.minX+Double(index%policy.columns)*(policy.tileWidth+6),
                                y:bounds.minY+Double(index/policy.columns)*(policy.tileHeight+6)),anchor:.topLeading,
                       proposal:.init(width:policy.tileWidth,height:policy.tileHeight))
        }
    }
}

struct NativeLiveMediaCard: View {
    @EnvironmentObject private var appModel: AppModel
    let input: NativeLiveAttachmentPresentationInput
    var compactImage = false
    var stickerImage = false
    var draftData: Data? = nil
    var onImageOpen: (() -> Void)? = nil
    @StateObject private var loader = NativeLiveMediaLoadState()
    @State private var lease: NativeLiveFilePreviewLease?
    @State private var retry = 0
    @State private var targetPixels = 1024
    @Environment(\.displayScale) private var displayScale
    @State private var isOpening = false
    @State private var openError: String?
    @State private var ownGallery: NativeLiveGallerySelection?

    @ViewBuilder var body: some View {
        if input.mediaKind == .audio { NativeLiveAudioAttachmentBubble(input: input) }
        else { ordinaryBody }
    }

    private var ordinaryBody: some View {
        VStack(alignment:.leading,spacing:6) {
            if stickerImage || input.isMemeSticker {
                stickerTile
            } else if compactImage {
                compactTile
            } else if input.mediaKind == .bitmap, let image = loader.image {
                Button {
                    if let onImageOpen { onImageOpen() }
                    else { ownGallery = .init(inputs:[input],selectedID:input.entityID ?? input.draftID) }
                } label: {
                    GeometryReader { geometry in
                        Image(uiImage:image).resizable().scaledToFill()
                            .frame(width:geometry.size.width,height:geometry.size.height).clipped()
                    }
                }
                .buttonStyle(.plain)
                .aspectRatio(1,contentMode:.fit)
                .accessibilityLabel(input.filename)
                .overlay(alignment:.bottomLeading) {
                    if let label = input.stillPreviewLabel { Text(label).font(.caption).padding(5).background(.thinMaterial) }
                }
            } else {
                Button { open() } label: { fileLabel }
                    .buttonStyle(.plain).disabled(isOpening || input.presentationState == .uploading)
            }
            if !stickerImage && !input.isMemeSticker && !compactImage, let error = openError ?? loader.error {
                Text(error).font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Retry",action:retryFailedOperation)
                    if input.mediaKind == .bitmap { Button("Open file") { open() } }
                }.font(.caption).buttonStyle(.borderless)
            }
        }
        .frame(maxWidth:.infinity,maxHeight:compactImage ? .infinity : nil,alignment:.topLeading)
        .clipShape(RoundedRectangle(cornerRadius:12))
        .onGeometryChange(for:CGSize.self) { $0.size } action: { size in
            if size.width > 0 { targetPixels = min(3072,max(128,Int(size.width * displayScale))) }
        }
        .task(id:"\(input.entityID ?? input.draftID)|\(input.sha256 ?? "")|\(input.materialization)|\(retry)|\(targetPixels)") {
            if input.mediaKind == .bitmap { await loader.load(input,appModel:appModel,pixels:draftData == nil ? targetPixels : 256,draftData:draftData) }
            else { loader.state = input.presentationState }
        }
        .sheet(item:$lease,onDismiss:{ lease?.cleanup(); lease = nil }) {
            NativeLiveFileOpenView(lease:$0)
        }
        .fullScreenCover(item:$ownGallery) { NativeLiveImageGallery(selection:$0) }
    }

    @ViewBuilder private var stickerTile: some View {
        if let image = loader.image {
            Button {
                if let onImageOpen { onImageOpen() }
                else { ownGallery = .init(inputs:[input],selectedID:input.entityID ?? input.draftID) }
            } label: {
                Image(uiImage:image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth:220,maxHeight:220,alignment:.leading)
            }
            .buttonStyle(.plain)
            .frame(maxWidth:220,alignment:.leading)
            .accessibilityLabel(input.filename)
        } else {
            Color.clear.frame(width:220,height:220)
        }
    }

    @ViewBuilder private var compactTile: some View {
        if let image = loader.image {
            Button {
                if let onImageOpen { onImageOpen() }
                else { ownGallery = .init(inputs:[input],selectedID:input.entityID ?? input.draftID) }
            } label: {
                GeometryReader { geometry in
                    Image(uiImage:image).resizable().scaledToFill()
                        .frame(width:geometry.size.width,height:geometry.size.height).clipped()
                }
            }.buttonStyle(.plain).accessibilityLabel(input.filename)
            .overlay(alignment:.bottomLeading) {
                if let label = input.stillPreviewLabel { Text(label).font(.caption2).padding(4).background(.thinMaterial) }
            }
        } else {
            VStack(spacing:4) {
                Image(systemName:"photo")
                Text(input.filename).font(.caption2).lineLimit(1).truncationMode(.middle)
                if loader.state == .loading { ProgressView() }
                else if let error = openError ?? loader.error {
                    Text(error).font(.caption2).lineLimit(2)
                    HStack {
                        Button("Retry",action:retryFailedOperation)
                        Button("File") { open() }
                    }.font(.caption2)
                } else { Text(input.presentationState.rawValue).font(.caption2) }
            }
            .padding(6).frame(maxWidth:.infinity,maxHeight:.infinity)
            .background(Color.primary.opacity(0.045))
        }
    }

    private var fileLabel: some View {
        HStack(spacing:10) {
            Image(systemName:input.mediaKind == .svg ? "photo.artframe" : (input.mediaKind == .bitmap ? "photo" : "doc"))
            VStack(alignment:.leading,spacing:3) {
                Text(input.filename).font(.subheadline).lineLimit(2).truncationMode(.middle)
                HStack {
                    Text(input.mediaKind == .svg ? "SVG preview · Open" : input.mimeType)
                    if let size = input.sizeBytes { Text(ByteCountFormatter.string(fromByteCount:Int64(size),countStyle:.file)) }
                }.font(.caption).lineLimit(2).foregroundStyle(.secondary)
                if input.mediaKind == .svg { Text("System preview availability depends on this SVG.").font(.caption).foregroundStyle(.secondary) }
                if input.presentationState == .uploading { Text("Uploading…").font(.caption) }
                if input.presentationState == .failed || input.presentationState == .unavailable { Text(input.presentationState.rawValue).font(.caption) }
            }
            Spacer(minLength:0)
            if loader.state == .loading || isOpening { ProgressView() }
            else { Image(systemName:"arrow.up.right.square").foregroundStyle(.secondary) }
        }
        .padding(11).frame(maxWidth:.infinity,alignment:.leading)
        .background(Color.primary.opacity(0.045),in:RoundedRectangle(cornerRadius:12))
    }

    private func retryFailedOperation() {
        switch NativeLiveMediaRetryPolicy.action(kind:input.mediaKind,previewFailed:openError != nil) {
        case .openFile: open()
        case .loadImage: openError = nil; loader.error = nil; loader.image = nil; retry += 1
        }
    }

    private func open() {
        guard !isOpening else { return }
        isOpening = true; openError = nil
        Task { @MainActor in
            defer { isOpening = false }
            do {
                let bytes: Data
                if let draftData { bytes = draftData }
                else { bytes = try await appModel.nativeLiveAttachmentBytes(input).data }
                let preview = try NativeLiveFilePreviewLease(data:bytes,filename:input.filename,mimeType:input.mimeType)
                lease = preview
            } catch { openError = (error as? NativeLiveMediaError ?? .previewFailed).localizedDescription }
        }
    }
}
