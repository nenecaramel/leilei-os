import SwiftUI
import UIKit
import Combine

@MainActor final class OrchestrationPhase: ObservableObject { @Published var draft = false }
@MainActor enum OrchestrationProbe {
    static let id = UUID(uuidString: "12345678-1234-1234-1234-123456789abc")!
    static let phase = OrchestrationPhase()
    static let app = AppModel()
    struct Call { let name: String; let target: String?; let text: String?; let attachments: [String]; let workspace: String?; let execution: NativeLiveExecutionSelection?; let pending: NativeLivePendingOperation?; let inputMode: NativeLiveInputMode? }
    static var calls: [Call] = [], lifecycle: [String] = [], uploads: [(Data, String, String, NativeLiveComposerAttachmentKind)] = []
    static var hold = false, failure = false, interrupted = false
    static var midCalls = 0, interruptCalls = 0, draftCommits = 0, running = false
    static func pause() async { while hold { try? await Task.sleep(for: .milliseconds(5)) } }
    static func operation(_ name: String, _ target: String?, _ text: String?, _ attachments: [String], _ workspace: String?, _ execution: NativeLiveExecutionSelection?, _ pending: NativeLivePendingOperation?, inputMode: NativeLiveInputMode? = nil) async throws {
        calls.append(.init(name: name, target: target, text: text, attachments: attachments, workspace: workspace, execution: execution, pending: pending, inputMode: inputMode))
        await pause()
        if interrupted { throw NativeLiveSendError.interrupted }
        if failure { throw NativeLiveSendError.notReady }
    }
    static func upload(_ data: Data, _ name: String, _ mime: String, _ kind: NativeLiveComposerAttachmentKind) async throws -> NativeLiveChatAttachmentSnapshot {
        uploads.append((data, name, mime, kind)); await pause()
        if failure { throw NativeLiveSendError.notReady }
        return .init(attachmentId: "remote-upload", filename: name, mimeType: mime, sizeBytes: data.count, sha256: String(repeating: "a", count: 64), kind: kind, status: "ready", boundMessageId: nil, createdAt: "now", expiresAt: "later")
    }
    static func path(head: String? = "head", token: String = "baseline") -> NativeLiveCurrentPathSnapshot {
        .init(conversationId: id.uuidString, title: "Fixture", currentHeadMessageId: head, updatedAt: "now", syncToken: token, truncated: false, olderCursor: nil, resetRequired: false, messages: [])
    }
}
// Defense in depth: no API traffic can leave this disposable test app.
final class OrchestrationNoNetwork: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
@MainActor enum OrchestrationChecks {
    static func firstResponder(_ view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        return view.subviews.lazy.compactMap(firstResponder).first
    }
    static var keyboardFocused: Bool {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).contains { firstResponder($0) != nil }
    }
    static func settle(_ condition: @escaping () -> Bool, line: UInt = #line) async {
        for _ in 0..<1000 { if condition() { return }; try? await Task.sleep(for: .milliseconds(5)) }
        preconditionFailure("Action did not settle at fixture line \(line), calls=\(OrchestrationProbe.calls.count), lifecycle=\(OrchestrationProbe.lifecycle), focused=\(keyboardFocused)")
    }
    static func run(_ view: ChatView, _ app: AppModel) async {
        guard !OrchestrationProbe.running else { return }; OrchestrationProbe.running = true
        try? await Task.sleep(for: .milliseconds(150))
        app.activeNativeLiveConversationID = OrchestrationProbe.id; app.nativeLiveCurrentPath = OrchestrationProbe.path(); app.isAuthenticated = true
        if view.isDraftConversation {
            OrchestrationProbe.calls = []; OrchestrationProbe.lifecycle = []; OrchestrationProbe.hold = true
            view.messageText = " draft "; view.sendMessage()
            let pendingID = view.pendingOperation!.id
            await settle { OrchestrationProbe.calls.count == 1 }
            let call = OrchestrationProbe.calls[0]
            precondition(call.pending?.id == pendingID && call.pending?.baselineSyncToken == "rebased", "Draft rebase must keep pending identity")
            precondition(call.workspace == nil && OrchestrationProbe.draftCommits == 1 && view.isDraftCommitInFlight, "Draft commit semantics")
            precondition(OrchestrationProbe.lifecycle == ["create"], "Draft creation must precede send")
            OrchestrationProbe.hold = false; await settle { !view.isDraftCommitInFlight && view.pendingOperation == nil }
            print("Chat orchestration smoke PASS: hosted SwiftUI text/edit/retry/voice/attachments, pending ownership, interrupted/failure recovery, runtime input/interrupt, lifecycle/conversation switch, draft rebase and focus")
            fflush(stdout); exit(0)
        }
        // Retry reserves the exact target synchronously, without consuming text.
        view.messageText = "retain"; OrchestrationProbe.hold = true
        view.retryMessage("exact-user"); view.retryMessage("different-user")
        precondition(view.pendingOperation?.targetUserMessageID == "exact-user")
        await settle { OrchestrationProbe.calls.count == 1 }
        precondition(OrchestrationProbe.calls[0].target == "exact-user" && view.messageText == "retain")
        OrchestrationProbe.hold = false; await settle { view.pendingOperation == nil }
        // Real canonical projection retains only ready existing attachments.
        let attachment: [String: NativeLiveJSONValue] = ["attachment_id": .string("retained-id"), "filename": .string("note.txt"), "mime_type": .string("text/plain"), "kind": .string("file"), "materialization": .string("ready"), "size_bytes": .number(7)]
        let message = NativeLiveCurrentPathMessage(id: "edit-user", conversationId: OrchestrationProbe.id.uuidString, parentMessageId: nil, role: "user", status: "completed", createdAt: "now", completedAt: "now", blocks: [
            .init(id: "text", ordinal: 0, kind: "text", rawType: "text", text: "Edit original", payload: nil, createdAt: "now"),
            .init(id: "file", ordinal: 1, kind: "attachment", rawType: "attachment", text: nil, payload: attachment, createdAt: "now")])
        view.beginEditing(message); await settle { keyboardFocused }
        precondition(view.editDraft?.targetUserMessageID == "edit-user" && view.messageText == "Edit original")
        precondition(view.composerAttachments.count == 1 && view.composerAttachments[0].remoteAttachmentID == "retained-id" && view.composerAttachments[0].data == nil && view.composerAttachments[0].presentationMetadata["size_bytes"] == .number(7), "Retained edit metadata/data semantics")
        let retainedID = view.composerAttachments[0].id
        view.retryAttachmentUpload(retainedID); precondition(view.composerAttachments[0].state == .ready("retained-id") && OrchestrationProbe.uploads.isEmpty, "Retained attachment has no bytes to re-upload")
        view.messageText = "Changed"; OrchestrationProbe.failure = true; OrchestrationProbe.hold = true; view.sendMessage()
        await settle { !keyboardFocused }
        precondition(view.editDraft == nil && view.messageText.isEmpty && view.composerAttachments.isEmpty)
        await settle { OrchestrationProbe.calls.count == 2 }
        precondition(OrchestrationProbe.calls.last?.target == "edit-user" && OrchestrationProbe.calls.last?.attachments == ["retained-id"])
        view.messageText = "newer typing"; OrchestrationProbe.hold = false; await settle { view.editDraft != nil }
        await settle { keyboardFocused }
        precondition(view.messageText == "newer typing" && view.composerAttachments[0].id == retainedID, "Edit failure restores attachments without overwriting newer text")
        OrchestrationProbe.failure = false; OrchestrationProbe.interrupted = true; view.sendMessage(); await settle { view.pendingOperation == nil }
        precondition(view.editDraft == nil && view.messageText.isEmpty && view.composerAttachments.isEmpty, "Interrupted edit must not restore draft")
        OrchestrationProbe.interrupted = false
        // Text selection and attachment identities are forwarded unchanged.
        view.model = .opus46; view.thinking = .disabled; view.effort = .max
        view.messageText = "  send text  "; view.composerAttachments = [.init(existingAttachmentID: "send-attachment", filename: "a.txt", mimeType: "text/plain", kind: .file)]
        OrchestrationProbe.failure = true; OrchestrationProbe.hold = true; view.sendMessage()
        let sendID = view.pendingOperation!.id; await settle { OrchestrationProbe.calls.count == 4 }
        let send = OrchestrationProbe.calls.last!
        precondition(send.text == "send text" && send.attachments == ["send-attachment"] && send.pending?.id == sendID && send.pending?.inputMode == .text && send.inputMode == .text && send.workspace == nil)
        precondition(send.execution == .init(model: .opus46, thinking: .disabled, effort: .max))
        OrchestrationProbe.hold = false; await settle { view.pendingOperation == nil }
        precondition(view.messageText == "send text" && view.composerAttachments[0].remoteAttachmentID == "send-attachment")
        view.cancelEditing(); OrchestrationProbe.failure = false
        precondition(view.voiceEnabled, "Voice gating requires empty authenticated active page")
        view.sendVoiceMessage(" voice transcript "); await settle { OrchestrationProbe.calls.count == 5 && view.pendingOperation == nil }
        precondition(OrchestrationProbe.calls.last?.pending?.inputMode == .voice && OrchestrationProbe.calls.last?.inputMode == .voice && OrchestrationProbe.calls.last?.text == "voice transcript" && OrchestrationProbe.calls.last?.attachments == [])
        // Real attachment storage, limits, retry and late completion after removal.
        OrchestrationProbe.failure = true
        view.addAttachment(data: Data([1,2,3]), filename: "a.bin", mimeType: "application/octet-stream", kind: .file)
        await settle { if case .failed = view.composerAttachments.first?.state { return true }; return false }
        let uploadID = view.composerAttachments[0].id
        OrchestrationProbe.failure = false; OrchestrationProbe.hold = true; view.retryAttachmentUpload(uploadID)
        precondition(view.composerAttachments[0].id == uploadID && view.composerAttachments[0].state == .uploading)
        OrchestrationProbe.hold = false; await settle { view.composerAttachments[0].isReady }
        precondition(view.composerAttachments[0].id == uploadID && view.composerAttachments[0].remoteAttachmentID == "remote-upload" && view.composerAttachments[0].data == Data([1,2,3]))
        precondition(OrchestrationProbe.uploads.allSatisfy { $0.0 == Data([1,2,3]) && $0.1 == "a.bin" && $0.2 == "application/octet-stream" && $0.3 == .file })
        view.composerAttachments = []; OrchestrationProbe.hold = true
        for _ in 0..<9 { view.addAttachment(data: Data([1]), filename: "limit", mimeType: "text/plain", kind: .file) }
        precondition(view.composerAttachments.count == 8); view.composerAttachments = []
        OrchestrationProbe.hold = false; try? await Task.sleep(for: .milliseconds(50)); precondition(view.composerAttachments.isEmpty, "Late upload cannot resurrect removed attachment")
        view.addAttachment(data: Data(), filename: "empty", mimeType: "text/plain", kind: .file)
        view.addAttachment(data: Data(count: 20*1024*1024+1), filename: "big", mimeType: "text/plain", kind: .file)
        precondition(view.composerAttachments.isEmpty)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("import.txt"); try! Data("file bytes".utf8).write(to: url)
        await view.importFiles(.success([url])); await settle { view.composerAttachments.first?.isReady == true }
        precondition(view.composerAttachments[0].filename == "import.txt" && view.composerAttachments[0].kind == .file && view.composerAttachments[0].data == Data("file bytes".utf8))
        try! FileManager.default.removeItem(at: url); view.cancelEditing()
        // Runtime reservation remains on the hosted State, and text waits for evidence.
        app.nativeLiveRuntimeSurface = .init(prepareID: "runtime", conversationID: OrchestrationProbe.id, events: [], interactions: [], controls: [], nextAfterSequence: 0)
        // Let the hosted view observe the new prepare ID before reserving a control.
        try? await Task.sleep(for: .milliseconds(50))
        view.messageText = "mid turn"; view.sendMidTurnInput("mid turn"); await settle { view.pendingMidTurnDelivery != nil }
        precondition(view.messageText == "mid turn" && OrchestrationProbe.midCalls == 1)
        view.reconcilePendingMidTurnDelivery("lifecycle:refused"); precondition(view.messageText == "mid turn")
        view.sendMidTurnInput("mid turn"); await settle { view.pendingMidTurnDelivery != nil }
        view.reconcilePendingMidTurnDelivery("receipt:queued"); precondition(view.messageText.isEmpty)
        OrchestrationProbe.hold = true; view.interruptCurrentTurn(); view.interruptCurrentTurn(); await settle { OrchestrationProbe.interruptCalls == 1 }
        OrchestrationProbe.hold = false; await settle { !view.isRuntimeControlInFlight }
        view.messageText = "switch retains"; view.pendingMidTurnDelivery = .init(controlID: "old", text: "switch retains")
        app.nativeLiveRuntimeSurface = nil; await settle { view.pendingMidTurnDelivery == nil }; precondition(view.messageText == "switch retains", "Turn disappearance must unlock without erasing text")
        OrchestrationProbe.lifecycle = []; await view.refreshConversationPage()
        precondition(OrchestrationProbe.lifecycle == ["history", "path", "observe:" + OrchestrationProbe.id.uuidString], "Lifecycle order")
        app.activeNativeLiveConversationID = UUID(); await settle { OrchestrationProbe.lifecycle.contains("recover") }
        view.cancelEditing(); OrchestrationProbe.running = false; OrchestrationProbe.phase.draft = true
    }
}
struct OrchestrationHost: View {
    @ObservedObject var phase = OrchestrationProbe.phase
    var body: some View {
        ChatView(isDraftConversation: phase.draft, draftConversationID: OrchestrationProbe.id, onDraftCommitted: { OrchestrationProbe.draftCommits += 1 })
            .id(phase.draft).environmentObject(OrchestrationProbe.app).environment(\.scenePhase, .active)
    }
}
@main final class OrchestrationApp: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { URLProtocol.registerClass(OrchestrationNoNetwork.self); return true }
    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration { let config = UISceneConfiguration(name: nil, sessionRole: session.role); config.delegateClass = OrchestrationScene.self; return config }
}
final class OrchestrationScene: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) { guard let scene = scene as? UIWindowScene else { return }; let window = UIWindow(windowScene: scene); window.rootViewController = UIHostingController(rootView: OrchestrationHost()); self.window = window; window.makeKeyAndVisible() }
}
