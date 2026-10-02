import SwiftUI
import QuickLook
import CryptoKit
import UIKit
import Foundation

struct NativeLiveAttachmentBlockView: View {
    @EnvironmentObject private var appModel: AppModel

    let block: NativeLiveCurrentPathBlock

    @State private var downloadURL: URL?
    @State private var preview: NativeLiveAttachmentPreview?
    @State private var previewDirectoryURL: URL?
    @State private var isPreparingPreview = false

    private var payload: [String: NativeLiveJSONValue] {
        block.payload ?? [:]
    }

    private var attachmentID: String? {
        payload["attachment_id"]?.stringValue
    }

    private var filename: String {
        payload["filename"]?.stringValue ?? "Attachment"
    }

    private var mimeType: String {
        payload["mime_type"]?.stringValue
            ?? "application/octet-stream"
    }

    private var expectedSHA256: String? {
        payload["sha256"]?.stringValue?.lowercased()
    }

    private var expectedSize: Int? {
        guard let value =
                payload["size_bytes"]?.numberValue,
              value >= 0,
              value.rounded() == value,
              value <= Double(Int.max) else {
            return nil
        }
        return Int(value)
    }

    private var isImage: Bool {
        payload["kind"]?.stringValue == "image"
            || mimeType.hasPrefix("image/")
    }

    private var sizeText: String? {
        guard let expectedSize else { return nil }
        return ByteCountFormatter.string(
            fromByteCount: Int64(expectedSize),
            countStyle: .file
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isImage,
               let downloadURL {
                Button {
                    openPreview()
                } label: {
                    AsyncImage(url: downloadURL) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(maxHeight: 260)
                                .clipShape(
                                    RoundedRectangle(
                                        cornerRadius: 12,
                                        style: .continuous
                                    )
                                )
                        case .failure:
                            attachmentRowContent
                        case .empty:
                            ZStack {
                                RoundedRectangle(
                                    cornerRadius: 12,
                                    style: .continuous
                                )
                                .fill(
                                    Color.primary.opacity(0.045)
                                )
                                ProgressView()
                            }
                            .frame(height: 120)
                        @unknown default:
                            attachmentRowContent
                        }
                    }
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    openPreview()
                } label: {
                    attachmentRowContent
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: attachmentID) {
            guard let attachmentID else { return }
            downloadURL =
                await appModel.nativeLiveAttachmentDownloadURL(
                    attachmentID: attachmentID
                )
        }
        .sheet(item: $preview, onDismiss: cleanupPreview) {
            NativeLiveAttachmentQuickLook(
                fileURL: $0.fileURL
            )
            .presentationBackground(
                Color(.systemBackground)
            )
        }
    }

    private var attachmentRowContent: some View {
        HStack(spacing: 10) {
            Image(
                systemName:
                    isImage
                        ? "photo"
                        : "doc"
            )
            .font(.system(size: 15))
            .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text(filename)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.primary)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    Text(mimeType)
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
            } else if downloadURL != nil {
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
        guard !isPreparingPreview else { return }
        if preview != nil { return }
        isPreparingPreview = true

        Task { @MainActor in
            defer { isPreparingPreview = false }
            guard let attachmentID else { return }
            let remoteURL: URL?
            if let downloadURL {
                remoteURL = downloadURL
            } else {
                remoteURL =
                    await appModel.nativeLiveAttachmentDownloadURL(
                        attachmentID: attachmentID
                    )
            }
            guard let remoteURL else { return }

            do {
                let (data, response) =
                    try await URLSession.shared.data(
                        from: remoteURL
                    )
                guard let http =
                        response as? HTTPURLResponse,
                      (200..<300).contains(
                        http.statusCode
                      ) else {
                    return
                }
                if let expectedSize,
                   data.count != expectedSize {
                    return
                }
                if let expectedSHA256 {
                    let digest = SHA256.hash(data: data)
                    let actual = digest.map {
                        String(format: "%02x", $0)
                    }.joined()
                    guard actual == expectedSHA256 else {
                        return
                    }
                }

                let directory =
                    FileManager.default.temporaryDirectory
                    .appendingPathComponent(
                        "LeileiOS-AttachmentPreview",
                        isDirectory: true
                    )
                    .appendingPathComponent(
                        block.id,
                        isDirectory: true
                    )
                try FileManager.default.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true
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
                preview = NativeLiveAttachmentPreview(
                    fileURL: localURL
                )
            } catch {
                return
            }
        }
    }

    private func cleanupPreview() {
        if let previewDirectoryURL {
            try? FileManager.default.removeItem(
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
