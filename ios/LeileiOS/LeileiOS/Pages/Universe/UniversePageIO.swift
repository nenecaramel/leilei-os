import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    func recheckImport() async {
        importError = nil
        importUncertain = false
        await load()
    }

    func handleImportedFile(
        _ result: Result<[URL], Error>
    ) {
        if case .failure(let error) = result {
            let cocoaError = error as NSError
            if cocoaError.domain == NSCocoaErrorDomain,
               cocoaError.code == NSUserCancelledError {
                return
            }

            importPreview = nil
            importError =
                "文件无法用于迁移"
            importUncertain = false
            return
        }

        guard case .success(let urls) = result,
              let url = urls.first
        else {
            return
        }

        importPreview = nil
        importError = nil
        importUncertain = false

        let didAccess =
            url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        do {
            let data = try Data(
                contentsOf: url
            )
            let preview =
                try UniverseImportParser.parse(
                    data
                )
            importFileName =
                url.lastPathComponent
            importPreview = preview
        } catch {
            importFileName =
                url.lastPathComponent
            importPreview = nil
            importError =
                "文件无法用于迁移"
        }
    }

    func confirmImport() async {
        guard let preview = importPreview,
              !importCommitting,
              !importUncertain
        else {
            return
        }

        importCommitting = true
        importError = nil
        defer {
            importCommitting = false
        }

        do {
            let service =
                UniverseAPIService(
                    api: appModel.api
                )
            let fresh =
                try await service.initialize(
                    preview.snapshot
                )

            state = .ready(fresh)
            importPreview = nil
            importFileName = nil
            importUncertain = false

            do {
                try UniverseImportParser.verify(
                    expected: preview.snapshot,
                    actual: fresh.snapshot
                )
                showNotice("Universe 已迁移")
            } catch {
                showNotice(
                    "Universe 已存在或状态已变化，未覆盖现有内容"
                )
            }
        } catch let error as
            UniverseAPIService.InitializationError {
            switch error {
            case .notWritten:
                importError =
                    "迁移未写入，可以重新确认。"

            case .uncertain:
                importUncertain = true
                importError =
                    "迁移状态暂时无法确认，请先重新读取；不要再次提交。"

            case .alreadyInitialized:
                importUncertain = true
                importError =
                    "服务器已有内容，未覆盖现有内容，请重新读取。"
            }
        } catch {
            importError =
                "迁移未完成，请重新确认。"
        }
    }

    func prepareExport(
        _ snapshot: UniverseSnapshot
    ) {
        let now = Date()
        let formatter =
            ISO8601DateFormatter()
        formatter.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds,
        ]

        let payload =
            UniverseExportPayload(
                snapshot: snapshot,
                exportedAt:
                    formatter.string(
                        from: now
                    )
            )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [
            .prettyPrinted,
            .sortedKeys,
        ]

        guard let data =
            try? encoder.encode(payload)
        else {
            showNotice(
                "导出未完成"
            )
            return
        }

        exportDocument =
            UniverseJSONDocument(
                data: data
            )

        let filenameFormatter =
            DateFormatter()
        filenameFormatter.locale =
            Locale(identifier: "en_US_POSIX")
        filenameFormatter.dateFormat =
            "yyyy-MM-dd"
        exportFilename =
            "蕾蕾宇宙备份-\(filenameFormatter.string(from: now))"
        exportPresented = true
    }
}
