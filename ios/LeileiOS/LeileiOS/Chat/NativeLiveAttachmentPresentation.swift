import SwiftUI
import UIKit
import QuickLook
import ImageIO
import Foundation

struct NativeLiveOptimisticAttachmentGroupView: View {
    let attachments:
        [NativeLiveComposerAttachmentDraft]

    private let width: CGFloat = 280
    private let gap: CGFloat = 4

    private var images:
        [NativeLiveComposerAttachmentDraft] {
        attachments.filter {
            $0.kind == .image
        }
    }

    private var files:
        [NativeLiveComposerAttachmentDraft] {
        attachments.filter {
            $0.kind != .image
        }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            if !images.isEmpty {
                imageLayout
            }

            ForEach(files) { attachment in
                HStack(spacing: 10) {
                    Image(systemName: "doc")
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                        .frame(width: 22)

                    VStack(
                        alignment: .leading,
                        spacing: 2
                    ) {
                        Text(attachment.filename)
                            .font(.system(
                                size: 14,
                                weight: .medium
                            ))
                            .foregroundStyle(.primary)
                            .lineLimit(2)

                        Text(
                            nativeLiveDraftFileTypeLabel(
                                attachment
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 0)

                    ProgressView()
                        .controlSize(.small)
                }
                .padding(.horizontal, 11)
                .padding(.vertical, 10)
                .frame(width: width)
                .background(
                    Color.primary.opacity(0.045),
                    in: RoundedRectangle(
                        cornerRadius: 11,
                        style: .continuous
                    )
                )
            }
        }
        .frame(width: width, alignment: .trailing)
        .opacity(0.92)
    }

    @ViewBuilder
    private var imageLayout: some View {
        switch images.count {
        case 1:
            draftImage(images[0])
                .frame(
                    width: width,
                    height: 220
                )

        case 2:
            HStack(spacing: gap) {
                draftImage(images[0])
                draftImage(images[1])
            }
            .frame(width: width, height: 150)

        case 3:
            HStack(spacing: gap) {
                draftImage(images[0])
                    .frame(
                        width:
                            (width - gap)
                            * 2 / 3,
                        height: 188
                    )

                VStack(spacing: gap) {
                    draftImage(images[1])
                    draftImage(images[2])
                }
                .frame(
                    width:
                        (width - gap)
                        / 3,
                    height: 188
                )
            }
            .frame(width: width, height: 188)

        default:
            LazyVGrid(
                columns: [
                    GridItem(
                        .fixed((width - gap) / 2),
                        spacing: gap
                    ),
                    GridItem(
                        .fixed((width - gap) / 2),
                        spacing: gap
                    ),
                ],
                spacing: gap
            ) {
                ForEach(images) { attachment in
                    draftImage(attachment)
                        .frame(height: 138)
                }
            }
            .frame(width: width)
        }
    }

    private func draftImage(
        _ attachment:
            NativeLiveComposerAttachmentDraft
    ) -> some View {
        NativeLiveOptimisticDraftImage(
            attachment: attachment
        )
    }
}


private struct NativeLiveOptimisticDraftImage: View {
    let attachment:
        NativeLiveComposerAttachmentDraft

    @State private var thumbnail: UIImage?

    var body: some View {
        ZStack {
            if let thumbnail {
                Image(uiImage: thumbnail)
                    .resizable()
                    .scaledToFill()
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
                    .clipped()
            } else {
                RoundedRectangle(
                    cornerRadius: 13,
                    style: .continuous
                )
                .fill(Color.primary.opacity(0.045))

                Image(systemName: "photo")
                    .font(.system(size: 20))
                    .foregroundStyle(.secondary)
            }
        }
        .clipShape(
            RoundedRectangle(
                cornerRadius: 13,
                style: .continuous
            )
        )
        .task(id: attachment.id) {
            guard thumbnail == nil,
                  let data = attachment.data else {
                return
            }
            thumbnail =
                nativeLiveAttachmentDecodedImage(
                    data,
                    maxPixelSize: 640
                )
        }
    }
}


private func nativeLiveDraftFileTypeLabel(
    _ attachment:
        NativeLiveComposerAttachmentDraft
) -> String {
    let ext = (attachment.filename as NSString)
        .pathExtension
        .uppercased()
    if !ext.isEmpty {
        return ext
    }

    switch attachment.mimeType {
    case "application/pdf":
        return "PDF"
    case "text/plain":
        return "TXT"
    case "text/markdown":
        return "MD"
    case "application/json":
        return "JSON"
    case "application/zip":
        return "ZIP"
    default:
        return "File"
    }
}


private enum NativeLiveAttachmentPresentation: Equatable {
    case standalone
    case imageTile
}


private struct NativeLiveAttachmentGallerySelection:
    Identifiable {
    let id: String
}


struct NativeLiveAttachmentGroupView: View {
    let blocks: [NativeLiveCurrentPathBlock]
    var isUserMessage = false

    @State private var gallerySelection:
        NativeLiveAttachmentGallerySelection?

    private let width: CGFloat = 280
    private let gap: CGFloat = 4

    private var imageBlocks: [NativeLiveCurrentPathBlock] {
        blocks.filter(nativeLiveAttachmentIsImage)
    }

    private var fileBlocks: [NativeLiveCurrentPathBlock] {
        blocks.filter {
            !nativeLiveAttachmentIsImage($0)
        }
    }

    var body: some View {
        VStack(
            alignment:
                isUserMessage
                    ? .trailing
                    : .leading,
            spacing: 8
        ) {
            if !imageBlocks.isEmpty {
                imageLayout
            }

            ForEach(fileBlocks) { block in
                NativeLiveAttachmentBlockView(
                    block: block
                )
                .frame(width: width)
            }
        }
        .frame(
            width: width,
            alignment:
                isUserMessage
                    ? .trailing
                    : .leading
        )
        .fullScreenCover(
            item: $gallerySelection
        ) { selection in
            NativeLiveAttachmentGallery(
                blocks: imageBlocks,
                initialID: selection.id
            )
        }
    }

    @ViewBuilder
    private var imageLayout: some View {
        switch imageBlocks.count {
        case 1:
            imageTile(
                imageBlocks[0],
                presentation: .standalone
            )
            .frame(maxWidth: width)

        case 2:
            HStack(spacing: gap) {
                imageTile(imageBlocks[0])
                imageTile(imageBlocks[1])
            }
            .frame(width: width, height: 150)

        case 3:
            HStack(spacing: gap) {
                imageTile(imageBlocks[0])
                    .frame(
                        width:
                            (width - gap)
                            * 2 / 3,
                        height: 188
                    )

                VStack(spacing: gap) {
                    imageTile(imageBlocks[1])
                    imageTile(imageBlocks[2])
                }
                .frame(
                    width:
                        (width - gap)
                        / 3,
                    height: 188
                )
            }
            .frame(width: width, height: 188)

        default:
            let visible =
                Array(imageBlocks.prefix(4))
            let extra =
                imageBlocks.count
                - visible.count

            VStack(spacing: gap) {
                HStack(spacing: gap) {
                    imageTile(visible[0])
                    imageTile(visible[1])
                }

                HStack(spacing: gap) {
                    imageTile(visible[2])

                    ZStack {
                        imageTile(visible[3])

                        if extra > 0 {
                            RoundedRectangle(
                                cornerRadius: 13,
                                style: .continuous
                            )
                            .fill(
                                .black.opacity(0.38)
                            )
                            .allowsHitTesting(false)

                            Text("+\(extra)")
                                .font(.system(
                                    size: 24,
                                    weight: .semibold
                                ))
                                .foregroundStyle(.white)
                                .allowsHitTesting(false)
                        }
                    }
                }
            }
            .frame(
                width: width,
                height: width
            )
        }
    }

    private func imageTile(
        _ block: NativeLiveCurrentPathBlock,
        presentation:
            NativeLiveAttachmentPresentation = .imageTile
    ) -> some View {
        NativeLiveAttachmentBlockView(
            block: block,
            presentation: presentation,
            onImageTap: {
                gallerySelection =
                    NativeLiveAttachmentGallerySelection(
                        id: block.id
                    )
            }
        )
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
    }
}


private struct NativeLiveAttachmentGallery: View {
    @Environment(\.dismiss) private var dismiss

    let blocks: [NativeLiveCurrentPathBlock]
    @State private var selection: String

    init(
        blocks: [NativeLiveCurrentPathBlock],
        initialID: String
    ) {
        self.blocks = blocks
        _selection = State(initialValue: initialID)
    }

    private var selectedIndex: Int {
        blocks.firstIndex {
            $0.id == selection
        } ?? 0
    }

    private var selectedFilename: String {
        guard !blocks.isEmpty else {
            return "Attachment"
        }

        return nativeLiveAttachmentFilename(
            blocks[
                min(
                    selectedIndex,
                    blocks.count - 1
                )
            ]
        )
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            TabView(selection: $selection) {
                ForEach(blocks) { block in
                    NativeLiveAttachmentRemoteImage(
                        block: block,
                        mode: .fit,
                        cornerRadius: 0,
                        maxPixelSize: 1_600
                    )
                    .padding(.horizontal, 8)
                    .padding(.vertical, 64)
                    .tag(block.id)
                }
            }
            .tabViewStyle(
                .page(indexDisplayMode: .never)
            )

            VStack {
                HStack(spacing: 12) {
                    if blocks.count > 1 {
                        Text(
                            "\(selectedIndex + 1) / \(blocks.count)"
                        )
                        .font(.system(
                            size: 14,
                            weight: .medium
                        ))
                        .foregroundStyle(
                            .white.opacity(0.78)
                        )
                    }

                    Spacer()

                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(
                                size: 14,
                                weight: .semibold
                            ))
                            .foregroundStyle(.white)
                            .frame(
                                width: 36,
                                height: 36
                            )
                            .background(
                                .white.opacity(0.14),
                                in: Circle()
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        "Close attachment viewer"
                    )
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)

                Spacer()

                Text(selectedFilename)
                .font(.caption)
                .foregroundStyle(
                    .white.opacity(0.68)
                )
                .lineLimit(1)
                .padding(.horizontal, 22)
                .padding(.bottom, 12)
            }
        }
    }
}


private enum NativeLiveRemoteImageMode: Equatable {
    case fit
    case fill
}


@MainActor
private final class NativeLiveAttachmentImageCache {
    static let shared =
        NativeLiveAttachmentImageCache()

    private let cache =
        NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 80
        cache.totalCostLimit =
            48 * 1024 * 1024
    }

    func image(
        for key: String
    ) -> UIImage? {
        cache.object(
            forKey: key as NSString
        )
    }

    func insert(
        _ image: UIImage,
        for key: String,
        cost: Int
    ) {
        cache.setObject(
            image,
            forKey: key as NSString,
            cost: cost
        )
    }
}


private struct NativeLiveAttachmentRemoteImage: View {
    @EnvironmentObject private var appModel: AppModel

    let block: NativeLiveCurrentPathBlock
    let mode: NativeLiveRemoteImageMode
    let cornerRadius: CGFloat
    let maxPixelSize: Int

    @State private var image: UIImage?
    @State private var didFail = false
    @State private var retryGeneration = 0

    private var cacheKey: String {
        nativeLiveAttachmentCacheKey(block)
            + ":"
            + String(maxPixelSize)
    }

    var body: some View {
        ZStack {
            if let image {
                switch mode {
                case .fit:
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity
                        )

                case .fill:
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(
                            maxWidth: .infinity,
                            maxHeight: .infinity
                        )
                        .clipped()
                }
            } else {
                RoundedRectangle(
                    cornerRadius:
                        max(cornerRadius, 1),
                    style: .continuous
                )
                .fill(
                    Color.secondary.opacity(0.10)
                )

                if didFail {
                    VStack(spacing: 7) {
                        Image(
                            systemName:
                                "arrow.clockwise"
                        )
                        .font(.system(
                            size: 18,
                            weight: .semibold
                        ))

                        if mode == .fit {
                            Text("Retry")
                                .font(.caption)
                        }
                    }
                    .foregroundStyle(.secondary)
                } else {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .clipShape(
            RoundedRectangle(
                cornerRadius: cornerRadius,
                style: .continuous
            )
        )
        .contentShape(Rectangle())
        .onTapGesture {
            guard didFail else {
                return
            }
            retryGeneration += 1
        }
        .task(
            id:
                cacheKey
                + ":"
                + String(retryGeneration)
        ) {
            await loadImage()
        }
    }

    @MainActor
    private func loadImage() async {
        if let cached =
            NativeLiveAttachmentImageCache
                .shared
                .image(for: cacheKey) {
            image = cached
            didFail = false
            return
        }

        guard let attachmentID =
            nativeLiveAttachmentID(block) else {
            didFail = true
            return
        }

        do {
            let data =
                try await appModel.nativeLiveAttachmentData(
                    attachmentID: attachmentID,
                    expectedSize:
                        nativeLiveAttachmentExpectedSize(
                            block
                        ),
                    expectedSHA256:
                        nativeLiveAttachmentExpectedSHA256(
                            block
                        )
                )
            guard let loaded =
                    nativeLiveAttachmentDecodedImage(
                        data,
                        maxPixelSize:
                            maxPixelSize
                    ) else {
                didFail = true
                return
            }

            let pixelWidth =
                loaded.size.width
                * loaded.scale
            let pixelHeight =
                loaded.size.height
                * loaded.scale
            let decodedCost =
                Int(
                    min(
                        pixelWidth
                        * pixelHeight
                        * 4,
                        Double(Int.max)
                    )
                )

            NativeLiveAttachmentImageCache
                .shared
                .insert(
                    loaded,
                    for: cacheKey,
                    cost:
                        max(
                            data.count,
                            decodedCost
                        )
                )
            image = loaded
            didFail = false
        } catch {
            didFail = true
        }
    }
}


private func nativeLiveAttachmentDecodedImage(
    _ data: Data,
    maxPixelSize: Int
) -> UIImage? {
    guard let source =
            CGImageSourceCreateWithData(
                data as CFData,
                nil
            ) else {
        return nil
    }

    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways:
            true,
        kCGImageSourceCreateThumbnailWithTransform:
            true,
        kCGImageSourceThumbnailMaxPixelSize:
            maxPixelSize,
        kCGImageSourceShouldCacheImmediately:
            true,
    ]

    guard let image =
            CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                options as CFDictionary
            ) else {
        return nil
    }

    return UIImage(cgImage: image)
}


private func nativeLiveAttachmentID(
    _ block: NativeLiveCurrentPathBlock
) -> String? {
    block.payload?[
        "attachment_id"
    ]?.stringValue
}


private func nativeLiveAttachmentFilename(
    _ block: NativeLiveCurrentPathBlock
) -> String {
    block.payload?[
        "filename"
    ]?.stringValue
        ?? "Attachment"
}


private func nativeLiveAttachmentMIMEType(
    _ block: NativeLiveCurrentPathBlock
) -> String {
    block.payload?[
        "mime_type"
    ]?.stringValue
        ?? "application/octet-stream"
}


private func nativeLiveAttachmentExpectedSHA256(
    _ block: NativeLiveCurrentPathBlock
) -> String? {
    block.payload?["sha256"]?
        .stringValue?
        .lowercased()
}


private func nativeLiveAttachmentExpectedSize(
    _ block: NativeLiveCurrentPathBlock
) -> Int? {
    guard let value =
            block.payload?[
                "size_bytes"
            ]?.numberValue,
          value >= 0,
          value.rounded() == value,
          value <= Double(Int.max) else {
        return nil
    }
    return Int(value)
}


private func nativeLiveAttachmentCacheKey(
    _ block: NativeLiveCurrentPathBlock
) -> String {
    let id =
        nativeLiveAttachmentID(block)
        ?? block.id
    let sha =
        nativeLiveAttachmentExpectedSHA256(
            block
        )
        ?? "unknown"
    return id + ":" + sha
}


private func nativeLiveAttachmentIsImage(
    _ block: NativeLiveCurrentPathBlock
) -> Bool {
    let payload = block.payload ?? [:]
    let mimeType =
        payload["mime_type"]?.stringValue
        ?? "application/octet-stream"
    return payload["kind"]?.stringValue == "image"
        || mimeType.hasPrefix("image/")
}


private struct NativeLiveAttachmentBlockView: View {
    @EnvironmentObject private var appModel: AppModel

    let block: NativeLiveCurrentPathBlock
    let presentation:
        NativeLiveAttachmentPresentation
    let onImageTap: (() -> Void)?

    init(
        block: NativeLiveCurrentPathBlock,
        presentation:
            NativeLiveAttachmentPresentation = .standalone,
        onImageTap: (() -> Void)? = nil
    ) {
        self.block = block
        self.presentation = presentation
        self.onImageTap = onImageTap
    }

    @State private var preview:
        NativeLiveAttachmentPreview?
    @State private var previewDirectoryURL: URL?
    @State private var isPreparingPreview = false
    @State private var previewError: String?

    private var attachmentID: String? {
        nativeLiveAttachmentID(block)
    }

    private var filename: String {
        nativeLiveAttachmentFilename(block)
    }

    private var mimeType: String {
        nativeLiveAttachmentMIMEType(block)
    }

    private var expectedSize: Int? {
        nativeLiveAttachmentExpectedSize(
            block
        )
    }

    private var isImage: Bool {
        nativeLiveAttachmentIsImage(block)
    }

    private var fileTypeLabel: String {
        let ext = (filename as NSString)
            .pathExtension
            .uppercased()

        if !ext.isEmpty {
            return ext
        }

        switch mimeType {
        case "application/pdf":
            return "PDF"
        case "text/plain":
            return "TXT"
        case "text/markdown":
            return "MD"
        case "application/json":
            return "JSON"
        case "application/zip":
            return "ZIP"
        default:
            return isImage
                ? "Image"
                : "File"
        }
    }

    private var fileSymbol: String {
        let ext = (filename as NSString)
            .pathExtension
            .lowercased()

        if mimeType == "application/pdf"
            || ext == "pdf" {
            return "doc.richtext"
        }

        if [
            "zip", "tar", "gz", "7z", "rar",
        ].contains(ext) {
            return "archivebox"
        }

        if [
            "csv", "xls", "xlsx", "numbers",
        ].contains(ext) {
            return "tablecells"
        }

        if [
            "ppt", "pptx", "key",
        ].contains(ext) {
            return "rectangle.on.rectangle"
        }

        if mimeType.hasPrefix("video/") {
            return "play.rectangle"
        }

        if mimeType.hasPrefix("audio/") {
            return "waveform"
        }

        if mimeType.hasPrefix("text/")
            || [
                "md", "txt", "json", "yaml",
                "yml", "xml", "swift", "js",
                "ts", "py", "html", "css",
            ].contains(ext) {
            return "doc.text"
        }

        return isImage
            ? "photo"
            : "doc"
    }

    private var sizeText: String? {
        guard let expectedSize else {
            return nil
        }
        return ByteCountFormatter.string(
            fromByteCount:
                Int64(expectedSize),
            countStyle: .file
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isImage {
                Button {
                    if let onImageTap {
                        onImageTap()
                    } else {
                        openPreview()
                    }
                } label: {
                    switch presentation {
                    case .standalone:
                        NativeLiveAttachmentRemoteImage(
                            block: block,
                            mode: .fit,
                            cornerRadius: 13,
                            maxPixelSize: 1_200
                        )
                        .frame(
                            minHeight: 120,
                            maxHeight: 260
                        )

                    case .imageTile:
                        NativeLiveAttachmentRemoteImage(
                            block: block,
                            mode: .fill,
                            cornerRadius: 13,
                            maxPixelSize: 640
                        )
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(filename)
                .accessibilityHint("Opens image viewer")
            } else {
                Button {
                    openPreview()
                } label: {
                    attachmentRowContent
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens file preview")
            }
        }
        .sheet(
            item: $preview,
            onDismiss: cleanupPreview
        ) {
            NativeLiveAttachmentQuickLook(
                fileURL: $0.fileURL
            )
            .presentationBackground(
                Color(.systemBackground)
            )
        }
        .alert(
            "Couldn’t open attachment",
            isPresented: Binding(
                get: { previewError != nil },
                set: { isPresented in
                    if !isPresented {
                        previewError = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
                previewError = nil
            }
        } message: {
            Text(previewError ?? "")
        }
    }

    private var attachmentRowContent: some View {
        HStack(spacing: 10) {
            Image(systemName: fileSymbol)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                Text(filename)
                    .font(.system(
                        size: 14,
                        weight: .medium
                    ))
                    .foregroundStyle(.primary)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(fileTypeLabel)
                    if let sizeText {
                        Text("·")
                        Text(sizeText)
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            if isPreparingPreview {
                ProgressView()
                    .controlSize(.small)
            } else if attachmentID != nil {
                Image(systemName: "chevron.right")
                    .font(.system(
                        size: 11,
                        weight: .semibold
                    ))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 10)
        .background(
            Color.primary.opacity(0.045),
            in: RoundedRectangle(
                cornerRadius: 11,
                style: .continuous
            )
        )
        .contentShape(Rectangle())
    }

    private func openPreview() {
        guard !isPreparingPreview,
              preview == nil,
              let attachmentID else {
            return
        }

        isPreparingPreview = true

        Task { @MainActor in
            defer {
                isPreparingPreview = false
            }

            do {
                let data =
                    try await appModel.nativeLiveAttachmentData(
                        attachmentID: attachmentID,
                        expectedSize:
                            nativeLiveAttachmentExpectedSize(
                                block
                            ),
                        expectedSHA256:
                            nativeLiveAttachmentExpectedSHA256(
                                block
                            )
                    )

                let directory =
                    FileManager
                        .default
                        .temporaryDirectory
                        .appendingPathComponent(
                            "LeileiOS-AttachmentPreview",
                            isDirectory: true
                        )
                        .appendingPathComponent(
                            block.id,
                            isDirectory: true
                        )
                try FileManager.default
                    .createDirectory(
                        at: directory,
                        withIntermediateDirectories:
                            true
                    )

                let localURL =
                    directory.appendingPathComponent(
                        nativeLiveSafePreviewFilename(
                            filename
                        )
                    )
                try data.write(
                    to: localURL,
                    options: [.atomic]
                )
                previewDirectoryURL = directory
                preview =
                    NativeLiveAttachmentPreview(
                        fileURL: localURL
                    )
            } catch {
                previewError =
                    "The attachment could not be downloaded or verified."
            }
        }
    }

    private func cleanupPreview() {
        if let previewDirectoryURL {
            try? FileManager.default
                .removeItem(
                    at: previewDirectoryURL
                )
        }
        previewDirectoryURL = nil
        preview = nil
    }
}


private struct NativeLiveAttachmentPreview: Identifiable {
    let id = UUID()
    let fileURL: URL
}


private struct NativeLiveAttachmentQuickLook:
    UIViewControllerRepresentable {
    let fileURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(fileURL: fileURL)
    }

    func makeUIViewController(
        context: Context
    ) -> UINavigationController {
        let previewController = QLPreviewController()
        previewController.dataSource = context.coordinator
        return UINavigationController(
            rootViewController: previewController
        )
    }

    func updateUIViewController(
        _ uiViewController: UINavigationController,
        context: Context
    ) {}

    final class Coordinator:
        NSObject,
        QLPreviewControllerDataSource {
        let fileURL: URL

        init(fileURL: URL) {
            self.fileURL = fileURL
        }

        func numberOfPreviewItems(
            in controller: QLPreviewController
        ) -> Int {
            1
        }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            fileURL as NSURL
        }
    }
}


private func nativeLiveSafePreviewFilename(
    _ filename: String
) -> String {
    let cleaned = filename
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "\\", with: "_")
        .trimmingCharacters(
            in: .whitespacesAndNewlines
        )
    return cleaned.isEmpty
        ? "Attachment"
        : String(cleaned.prefix(180))
}
