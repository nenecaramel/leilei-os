import Foundation
import SwiftUI
import WebKit
import Combine
#if canImport(UIKit)
import UIKit
#endif

// Serves only hash-verified renderer-owned bundle assets. No general file or URL resolver.
final class NativeLiveVisualAssetHandler: NSObject, WKURLSchemeHandler {
    private let root: URL?
    private let manifest: [String: String]
    init(root: URL?) {
        self.root = root
        manifest = root.flatMap { try? Data(contentsOf: $0.appendingPathComponent("assets.json")) }
            .flatMap { try? JSONDecoder().decode([String:String].self, from: $0) } ?? [:]
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let root, let name = NativeLiveVisualNavigationPolicy.resourceName(task.request.url, allowed: Set(manifest.keys)),
              let data = try? Data(contentsOf: root.appendingPathComponent(name)),
              NativeLiveAttachmentIntegrity.sha256(data) == manifest[name] else {
            task.didFailWithError(NativeLiveVisualError.unavailable); return
        }
        let ext = (name as NSString).pathExtension
        let mime = ["html":"text/html","js":"application/javascript","css":"text/css","woff2":"font/woff2"][ext] ?? "application/octet-stream"
        task.didReceive(URLResponse(url: task.request.url!, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

private final class WeakVisualOwner { weak var value: NativeLiveVisualSandboxController?; init(_ value: NativeLiveVisualSandboxController) { self.value = value } }

@MainActor final class NativeLiveVisualSandboxController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    @Published private(set) var state = NativeLiveVisualRenderState()
    private(set) var view: WKWebView?
    private static var owners: [UUID:WeakVisualOwner] = [:]
    private let ownerID = UUID()
    private let assetsRoot: URL?
    private var desired: (NativeLiveVisualSandboxInput, Bool, Double)?
    private var signature: String?
    private var loaded = false, initialNavigation = true
    private var work: Task<Void,Never>?, timeout: Task<Void,Never>?
    init(assetsRoot: URL? = Bundle.main.url(forResource: "NativeLiveVisualAssets", withExtension: "bundle")) {
        self.assetsRoot = assetsRoot
        super.init()
        #if canImport(UIKit)
        NotificationCenter.default.addObserver(self, selector: #selector(handleVisualLifecycleNotification(_:)),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(handleVisualLifecycleNotification(_:)),
                                               name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
        #endif
    }
    deinit { NotificationCenter.default.removeObserver(self) }

    #if canImport(UIKit)
    @objc private func handleVisualLifecycleNotification(_ notification: Notification) {
        stop()
    }
    #endif

    func update(_ input: NativeLiveVisualSandboxInput, dark: Bool, scale: Double, retry: Int = 0) {
        let boundedScale = scale.isFinite ? min(2,max(1,scale)) : 1
        let key = "\(input.kind.rawValue)|\(input.identity)|\(dark)|\(boundedScale)|\(retry)"
        guard key != signature || view == nil else { return }
        signature = key; desired = (input,dark,boundedScale)
        work?.cancel(); timeout?.cancel()
        let generation = state.begin(now: ProcessInfo.processInfo.systemUptime)
        guard ensureView() else { state.fail("Visual renderer capacity unavailable. View source or retry."); return }
        if loaded { invalidatePage(generation) }
        schedule(generation)
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled, let self, self.state.generation == generation else { return }
            self.state.tick(now: ProcessInfo.processInfo.systemUptime)
            if self.state.phase == .failed { self.releaseView() }
        }
    }
    private func ensureView() -> Bool {
        if view != nil { return true }
        Self.owners = Self.owners.filter { $0.value.value != nil }
        guard Self.owners.count < 12, assetsRoot != nil else { return false }
        Self.owners[ownerID] = WeakVisualOwner(self)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.setURLSchemeHandler(NativeLiveVisualAssetHandler(root: assetsRoot), forURLScheme: NativeLiveVisualNavigationPolicy.scheme)
        // Handler is weak to avoid the WKUserContentController/coordinator retention cycle.
        configuration.userContentController.add(WeakVisualMessageHandler(self), name: "visual")
        let webView = WKWebView(frame: CGRect(x:0,y:0,width:640,height:480), configuration: configuration)
        webView.navigationDelegate = self; webView.uiDelegate = self
        #if canImport(UIKit)
        webView.isOpaque = false; webView.backgroundColor = .clear; webView.scrollView.backgroundColor = .clear
        #endif
        view = webView; loaded = false; initialNavigation = true
        webView.load(URLRequest(url: NativeLiveVisualNavigationPolicy.documentURL))
        return true
    }
    private func schedule(_ generation: Int) {
        work?.cancel()
        work = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled, let self, self.state.generation == generation, self.loaded else { return }
            self.render(generation)
        }
    }
    private func invalidatePage(_ generation: Int) {
        view?.callAsyncJavaScript("window.leileiVisualCancel(token)", arguments: ["token":generation], in:nil, in:.page, completionHandler: { _ in })
    }
    private func render(_ generation: Int) {
        guard let (input,dark,scale) = desired else { return }
        let arguments: [String:Any] = ["input":["kind":input.kind.rawValue,"source":input.source,"generation":generation,"dark":dark,"scale":scale]]
        view?.callAsyncJavaScript("return await window.leileiVisualRender(input)", arguments: arguments, in:nil, in:.page, completionHandler: { [weak self] result in
            guard let self, self.state.generation == generation else { return }
            if case .failure(let error) = result { self.fail("Visual script evaluation failed: "+((error as NSError).userInfo["WKJavaScriptExceptionMessage"] as? String ?? error.localizedDescription)) }
        })
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.webView === view,
              message.frameInfo.request.url == NativeLiveVisualNavigationPolicy.documentURL,
              let body = message.body as? [String:Any] else { return }
        if state.receive(body), state.phase == .ready { timeout?.cancel() }
        if state.phase == .failed { releaseView() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allow = NativeLiveVisualNavigationPolicy.allowsInitialDocument(action.request.url, isInitial: initialNavigation, isMainFrame: action.targetFrame?.isMainFrame == true)
        if allow { initialNavigation = false }
        decisionHandler(allow ? .allow : .cancel)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { guard webView === view else { return }; loaded = true; schedule(state.generation) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { guard webView === view else { return }; fail("Visual navigation failed") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { guard webView === view else { return }; fail("Visual assets unavailable") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { guard webView === view else { return }; fail("Visual content process terminated") }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    private func fail(_ message: String) { state.fail(message); work?.cancel(); timeout?.cancel(); releaseView() }
    private func releaseView() {
        view?.stopLoading(); view?.configuration.userContentController.removeScriptMessageHandler(forName: "visual")
        view?.navigationDelegate = nil; view?.uiDelegate = nil; view?.removeFromSuperview(); view = nil
        loaded = false; Self.owners[ownerID] = nil
    }
    func stop() { work?.cancel(); timeout?.cancel(); state.cancel(); signature = nil; desired = nil; releaseView() }
}

private final class WeakVisualMessageHandler: NSObject, WKScriptMessageHandler {
    weak var owner: NativeLiveVisualSandboxController?
    init(_ owner: NativeLiveVisualSandboxController) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { owner?.userContentController(controller,didReceive:message) }
}

#if canImport(UIKit)
struct NativeLiveVisualSandbox: UIViewRepresentable {
    @ObservedObject var controller: NativeLiveVisualSandboxController
    func makeUIView(context: Context) -> UIView { UIView() }
    func updateUIView(_ container: UIView, context: Context) {
        guard let view = controller.view else { return }
        if view.superview !== container { container.addSubview(view) }
        view.frame = container.bounds; view.autoresizingMask = [.flexibleWidth,.flexibleHeight]
    }
    static func dismantleUIView(_ uiView: UIView, coordinator: ()) { uiView.subviews.forEach { $0.removeFromSuperview() } }
}
#endif
