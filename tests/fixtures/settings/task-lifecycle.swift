@MainActor final class ControlledSettings: SettingsDataService {
    var previews: [(URL, CheckedContinuation<SettingsRestorePreview, Error>)] = []
    var restores: [(URL, String, CheckedContinuation<SettingsRestoreResult, Error>)] = []
    var exports: [CheckedContinuation<SettingsExportDocument, Error>] = []
    func exportData() async throws -> SettingsExportDocument { try await withCheckedThrowingContinuation { exports.append($0) } }
    func previewRestore(fileURL: URL) async throws -> SettingsRestorePreview { try await withCheckedThrowingContinuation { previews.append((fileURL, $0)) } }
    func executeRestore(fileURL: URL, previewFingerprint: String) async throws -> SettingsRestoreResult { try await withCheckedThrowingContinuation { restores.append((fileURL, previewFingerprint, $0)) } }
    func readDataSummary() async throws -> SettingsDataSummary { throw SettingsDataServiceError.unavailable }
    func readRuntimeStatus() async throws -> SettingsRuntimeStatus { throw SettingsDataServiceError.unavailable }
}
@MainActor final class RestoreHarness {
    let dataService = ControlledSettings()
    var selectedFileURL: URL?
    var preview: SettingsRestorePreview?
    var restoreResult: SettingsRestoreResult?
    var isPreviewing = false, isRestoring = false
    var previewGeneration = 0
    var errorMessage: String?
    var finished = 0
    // RESTORE_METHODS
    // CAN_RESTORE
    func select(_ url: URL) async {
        guard let generation = prepareRestorePreview(fileURL: url) else { return }
        await previewRestore(fileURL: url, generation: generation)
    }
    func performRestore() async { await restoreData(); finished += 1 }
}
@MainActor final class ExportHarness {
    let dataService = ControlledSettings()
    var isExporting = false
    var errorMessage: String?
    var exportedDocument: SettingsExportDocument?
    var finished = 0
    // EXPORT_METHOD
    func performExport() async { await exportData(); finished += 1 }
}
func preview(_ fingerprint: String) -> SettingsRestorePreview {
    SettingsRestorePreview(schemaVersion: 4, exportedAt: "2026-10-19T00:00:00Z", rawBytes: 10, auditIncluded: false,
        modules: [], previewFingerprint: fingerprint, canExecute: true)
}
let fileA = URL(fileURLWithPath: "/synthetic/a.json"), fileB = URL(fileURLWithPath: "/synthetic/b.json")
Task { @MainActor in
    switch CommandLine.arguments[1] {
    case "preview-race", "preview-same-file-race":
        let h = RestoreHarness()
        let a = Task { await h.select(fileA) }
        while h.dataService.previews.count < 1 { await Task.yield() }
        let selected = CommandLine.arguments[1] == "preview-same-file-race" ? fileA : fileB
        let b = Task { await h.select(selected) }
        while h.dataService.previews.count < 2 { await Task.yield() }
        h.dataService.previews[1].1.resume(returning: preview("fingerprint-B")); await b.value
        h.dataService.previews[0].1.resume(returning: preview("fingerprint-A")); await a.value
        precondition(h.selectedFileURL == selected && h.preview?.previewFingerprint == "fingerprint-B", "old preview overwrote the selected file")
        precondition(!h.isPreviewing && h.errorMessage == nil)
    case "selection-before-task-start":
        let h = RestoreHarness()
        let obsolete = h.prepareRestorePreview(fileURL: fileA)!
        let current = h.prepareRestorePreview(fileURL: fileA)!
        await h.previewRestore(fileURL: fileA, generation: obsolete)
        precondition(h.dataService.previews.isEmpty && h.isPreviewing, "queued obsolete preview must not enter the service")
        let task = Task { await h.previewRestore(fileURL: fileA, generation: current) }
        while h.dataService.previews.isEmpty { await Task.yield() }
        h.dataService.previews[0].1.resume(returning: preview("current")); await task.value
        precondition(h.preview?.previewFingerprint == "current" && !h.isPreviewing)
    case "selection-during-restore":
        let h = RestoreHarness(); h.selectedFileURL = fileA; h.preview = preview("A"); h.isRestoring = true
        let generation = h.previewGeneration
        precondition(h.prepareRestorePreview(fileURL: fileB) == nil)
        precondition(h.selectedFileURL == fileA && h.preview?.previewFingerprint == "A" && h.previewGeneration == generation && !h.isPreviewing)
    case "preview-failure-race":
        let h = RestoreHarness()
        let a = Task { await h.select(fileA) }
        while h.dataService.previews.count < 1 { await Task.yield() }
        let b = Task { await h.select(fileB) }
        while h.dataService.previews.count < 2 { await Task.yield() }
        h.dataService.previews[0].1.resume(throwing: SettingsDataServiceError.unavailable); await a.value
        precondition(h.isPreviewing && h.errorMessage == nil, "old failure ended the new loading state")
        h.dataService.previews[1].1.resume(returning: preview("B")); await b.value
        precondition(h.preview?.previewFingerprint == "B" && !h.isPreviewing)
    case "restore-single-flight":
        let h = RestoreHarness(); h.selectedFileURL = fileB; h.preview = preview("B")
        let first = Task { await h.performRestore() }
        while h.dataService.restores.count < 1 { await Task.yield() }
        let second = Task { await h.performRestore() }
        while h.finished == 0 && h.dataService.restores.count < 2 { await Task.yield() }
        precondition(h.dataService.restores.count == 1, "restore submitted twice before the disabled button repainted")
        precondition(h.dataService.restores[0].0 == fileB && h.dataService.restores[0].1 == "B")
        h.dataService.restores[0].2.resume(returning: SettingsRestoreResult(completed: true, schemaVersion: 4, exportedAt: "now", rawBytes: 10, auditIncluded: false, modules: []))
        await first.value; await second.value
        precondition(h.restoreResult?.completed == true && !h.isRestoring && h.errorMessage == nil)
    case "stale-preview":
        let h = RestoreHarness(); h.selectedFileURL = fileB; h.preview = preview("old")
        let request = Task { await h.performRestore() }
        while h.dataService.restores.count < 1 { await Task.yield() }
        h.dataService.restores[0].2.resume(throwing: LeileiAPIError.backend(status: 409, code: "IMPORT_PREVIEW_STALE", message: nil))
        await request.value
        precondition(h.restoreResult == nil && !h.isRestoring && h.preview == nil, "a rejected fingerprint must require a new preview")
        precondition(h.errorMessage?.contains("Choose the file again") == true)
        await h.performRestore()
        precondition(h.dataService.restores.count == 1, "stale preview must not be submitted again")
    case "export-single-flight":
        let h = ExportHarness(); let first = Task { await h.performExport() }
        while h.dataService.exports.count < 1 { await Task.yield() }
        let second = Task { await h.performExport() }
        while h.finished == 0 && h.dataService.exports.count < 2 { await Task.yield() }
        precondition(h.dataService.exports.count == 1, "export submitted twice")
        h.dataService.exports[0].resume(throwing: SettingsDataServiceError.unavailable)
        await first.value; await second.value
        precondition(!h.isExporting && h.exportedDocument == nil && h.errorMessage != nil)
        let retry = Task { await h.performExport() }
        while h.dataService.exports.count < 2 { await Task.yield() }
        h.dataService.exports[1].resume(returning: SettingsExportDocument(fileURL: fileA)); await retry.value
        precondition(h.exportedDocument?.fileURL == fileA && h.errorMessage == nil && !h.isExporting)
    default: preconditionFailure("unknown scenario")
    }
    print("PASS \(CommandLine.arguments[1])"); exit(0)
}
dispatchMain()
