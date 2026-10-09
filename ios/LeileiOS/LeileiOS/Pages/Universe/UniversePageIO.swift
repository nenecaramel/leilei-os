import Foundation
import SwiftUI
import UniformTypeIdentifiers

extension UniverseView {
    func discardImportSelection() {
        guard !importCommitting, !importUncertain else { return }
        importFileName = nil
        importPreview = nil
        importError = nil
    }

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
                "Unable to import this file."
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
                "Unable to import this file."
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
                showNotice("Universe imported")
            } catch {
                showNotice(
                    "Universe already contains data or has changed. No data was overwritten."
                )
            }
        } catch let error as
            UniverseAPIService.InitializationError {
            switch error {
            case .notWritten:
                importError =
                    "Import was not saved. You can confirm again."

            case .uncertain:
                importUncertain = true
                importError =
                    "Unable to confirm import status. Reload first; do not resubmit yet."

            case .alreadyInitialized:
                importUncertain = true
                importError =
                    "Universe already contains data. No changes were made. Reload to continue."
            }
        } catch {
            importError =
                "Import incomplete. Confirm again."
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
                "Unable to export."
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
            "Universe Backup-\(filenameFormatter.string(from: now))"
        exportPresented = true
    }
}
