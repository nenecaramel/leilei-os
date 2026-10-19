import SwiftUI
import UIKit

@MainActor final class HostedSettingsService: SettingsDataService {
    var previews: [(URL, CheckedContinuation<SettingsRestorePreview, Error>)] = []
    var restores: [(URL, String, CheckedContinuation<SettingsRestoreResult, Error>)] = []
    func previewRestore(fileURL: URL) async throws -> SettingsRestorePreview {
        try await withCheckedThrowingContinuation { previews.append((fileURL, $0)) }
    }
    func executeRestore(fileURL: URL, previewFingerprint: String) async throws -> SettingsRestoreResult {
        try await withCheckedThrowingContinuation { restores.append((fileURL, previewFingerprint, $0)) }
    }
    func exportData() async throws -> SettingsExportDocument { throw SettingsDataServiceError.unsupported }
    func readDataSummary() async throws -> SettingsDataSummary { throw SettingsDataServiceError.unsupported }
    func readRuntimeStatus() async throws -> SettingsRuntimeStatus { throw SettingsDataServiceError.unsupported }
}
@MainActor enum HostedSettingsProbe {
    static let service = HostedSettingsService()
    static var didRun = false
    static func wait(_ reason: String, until condition: () -> Bool) async {
        let limit = ContinuousClock.now + .seconds(12)
        while !condition() {
            precondition(ContinuousClock.now < limit, "Settings hosted timed out: \(reason)")
            try? await Task.sleep(for: .milliseconds(20))
        }
    }
    static func picker() -> UIDocumentPickerViewController? {
        let roots = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).compactMap(\.rootViewController)
        func find(_ controller: UIViewController) -> UIDocumentPickerViewController? {
            if let picker = controller as? UIDocumentPickerViewController { return picker }
            if let presented = controller.presentedViewController, let picker = find(presented) { return picker }
            return controller.children.compactMap { find($0) }.first
        }
        return roots.compactMap { find($0) }.first
    }
    static func preview(_ fingerprint: String) -> SettingsRestorePreview {
        SettingsRestorePreview(schemaVersion: 4, exportedAt: "2026-10-19T00:00:00Z", rawBytes: 2,
            auditIncluded: false, modules: [], previewFingerprint: fingerprint, canExecute: true)
    }
}
@main final class HostedSettingsApp: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: session.role)
        config.delegateClass = HostedSettingsScene.self
        return config
    }
}
final class HostedSettingsScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = UIHostingController(rootView: NavigationStack {
            SettingsRestoreContent(dataService: HostedSettingsProbe.service)
        })
        self.window = window
        window.makeKeyAndVisible()
    }
}

// SAME_FILE_RESTORE_PROBES
// Appended to the unchanged production view's source in the compilation copy,
// so probes read the real installed SwiftUI State rather than a surrogate owner.
extension SettingsRestoreContent {
    @MainActor func runHostedAcceptance() async {
        guard !HostedSettingsProbe.didRun else { return }
        HostedSettingsProbe.didRun = true
        let service = HostedSettingsProbe.service
        precondition(!canRestore && !isPreviewing && !isRestoring)
        isImporterPresented = true
        await HostedSettingsProbe.wait("native picker presentation") { HostedSettingsProbe.picker()?.view.window != nil }
        let cancelled = HostedSettingsProbe.picker()!
        precondition(cancelled.delegate != nil)
        cancelled.delegate?.documentPickerWasCancelled?(cancelled)
        // A real picker also dismisses its own presentation when Cancel is tapped.
        cancelled.dismiss(animated: false)
        await HostedSettingsProbe.wait("native picker cancellation") { !isImporterPresented && HostedSettingsProbe.picker() == nil }
        precondition(service.previews.isEmpty && service.restores.isEmpty && selectedFileURL == nil)
        print("Settings hosted native importer cancel PASS")

        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let fileA = documents.appendingPathComponent("synthetic-a.json")
        let fileB = documents.appendingPathComponent("synthetic-b.json")
        try! Data("{}".utf8).write(to: fileA)
        try! Data("{}".utf8).write(to: fileB)
        defer { try? FileManager.default.removeItem(at: fileA); try? FileManager.default.removeItem(at: fileB) }

        isImporterPresented = true
        await HostedSettingsProbe.wait("second native picker") { HostedSettingsProbe.picker()?.view.window != nil }
        let selected = HostedSettingsProbe.picker()!
        selected.delegate?.documentPicker?(selected, didPickDocumentsAt: [fileA])
        selected.dismiss(animated: false)
        await HostedSettingsProbe.wait("real fileImporter callback to service") { service.previews.count == 1 }
        precondition(selectedFileURL == fileA && isPreviewing && !canRestore)
        await restoreData()
        precondition(service.restores.isEmpty, "preview-incomplete restore admitted")
        service.previews[0].1.resume(returning: HostedSettingsProbe.preview("preview-a"))
        await HostedSettingsProbe.wait("preview installed") { preview?.previewFingerprint == "preview-a" && !isPreviewing }
        precondition(canRestore)
        print("Settings hosted native importer selection and preview PASS")

        let generation = prepareRestorePreview(fileURL: fileB)!
        let nextPreview = Task { await previewRestore(fileURL: fileB, generation: generation) }
        await HostedSettingsProbe.wait("replacement preview") { service.previews.count == 2 }
        precondition(preview == nil && isPreviewing && !canRestore)
        service.previews[1].1.resume(returning: HostedSettingsProbe.preview("preview-b"))
        await nextPreview.value
        precondition(selectedFileURL == fileB && canRestore)
        let restore = Task { await restoreData() }
        await HostedSettingsProbe.wait("restore admitted") { service.restores.count == 1 }
        precondition(isRestoring && !canRestore && prepareRestorePreview(fileURL: fileA) == nil)
        await restoreData()
        precondition(service.restores.count == 1 && selectedFileURL == fileB)
        precondition(service.restores[0].0 == fileB && service.restores[0].1 == "preview-b")
        service.restores[0].2.resume(throwing: LeileiAPIError.backend(status: 409, code: "IMPORT_PREVIEW_STALE", message: "Synthetic"))
        await restore.value
        precondition(!isRestoring && preview == nil && !canRestore && errorMessage != nil)
        await restoreData()
        precondition(service.restores.count == 1)
        print("Settings hosted restore single-flight, file lock and stale preview PASS")
        print("Settings hosted acceptance PASS")
        fflush(stdout)
        exit(0)
    }
}
