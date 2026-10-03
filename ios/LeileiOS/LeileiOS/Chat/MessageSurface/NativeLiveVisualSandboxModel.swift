import Foundation
import CoreFoundation

struct NativeLiveVisualSandboxInput: Equatable, Sendable {
    enum Kind: String, Sendable { case math, mermaid, svg }
    let kind: Kind
    let source: String
    let identity: String
    private init(kind: Kind, source: String, identity: String) { self.kind = kind; self.source = source; self.identity = identity }
    static func displayMath(_ model: NativeLiveMathPresentation) throws -> Self {
        guard model.isDisplay, !model.latex.isEmpty, model.latex.utf16.count <= 8192 else { throw NativeLiveVisualError.invalidInput }
        return .init(kind: .math, source: model.latex, identity: NativeLiveAttachmentIntegrity.sha256(Data(model.latex.utf8)))
    }
    static func mermaid(_ model: NativeLiveCodePresentation) throws -> Self {
        let source = model.code
        guard !source.isEmpty, source.utf16.count <= 20_000, !source.contains("%%{"),
              !source.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("---"),
              source.range(of: "(?im)^\\s*click\\b", options: .regularExpression) == nil else { throw NativeLiveVisualError.invalidInput }
        return .init(kind: .mermaid, source: source, identity: NativeLiveAttachmentIntegrity.sha256(Data(source.utf8)))
    }
    static func svg(_ verified: NativeLiveLoadedAttachment) throws -> Self {
        let value = try NativeLiveSVGSanitizer.sanitize(verified)
        return .init(kind: .svg, source: value.source, identity: verified.key.imageKey)
    }
}

enum NativeLiveVisualError: Error { case invalidInput, unsafeSVG, unavailable }

struct NativeLiveVisualRenderState: Equatable {
    enum Phase: String { case loading, ready, failed, fallback }
    private(set) var phase: Phase = .loading
    private(set) var generation = 0
    private(set) var naturalHeight: Double = 80
    private(set) var error: String?
    private(set) var deadline: Double?
    var inlineHeight: Double { min(480, max(44, naturalHeight)) }
    mutating func begin(now: Double) -> Int {
        generation += 1; phase = .loading; error = nil; deadline = now+8
        // Preserve prior height while coalescing a new render, avoiding a blank-size flash.
        return generation
    }
    @discardableResult mutating func receive(_ body: [String: Any]) -> Bool {
        guard let number = body["generation"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue, number.doubleValue == Double(generation),
              let event = body["event"] as? String, Set(body.keys).isSubset(of: ["generation","event","height","message"]),
              phase != .failed && phase != .fallback else { return false }
        switch event {
        case "ready": phase = .ready; deadline = nil
        case "contentHeight":
            guard let height = body["height"] as? NSNumber, CFGetTypeID(height) != CFBooleanGetTypeID() else { return false }
            let value = height.doubleValue
            guard value.isFinite, value >= 0 else { return false }
            naturalHeight = min(480, max(44, value))
        case "renderError": fail(body["message"] as? String ?? "Visual render failed")
        default: return false
        }
        return true
    }
    mutating func tick(now: Double) {
        if let deadline, now >= deadline { fail("Visual render timed out") }
    }
    mutating func fail(_ message: String) { phase = .failed; error = String(message.prefix(180)); deadline = nil }
    mutating func cancel() { generation += 1; phase = .fallback; deadline = nil }
}

// Only the one renderer-owned document may navigate. Asset requests use a separate allowlist.
enum NativeLiveVisualNavigationPolicy {
    static let scheme = "leilei-visual"
    static let documentURL = URL(string: "leilei-visual://bundle/shell.html")!
    static func allowsInitialDocument(_ url: URL?, isInitial: Bool, isMainFrame: Bool) -> Bool {
        isInitial && isMainFrame && url == documentURL
    }
    static func resourceName(_ url: URL?, allowed: Set<String>) -> String? {
        guard let url, url.scheme == scheme, url.host == "bundle", url.query == nil, url.fragment == nil,
              url.user == nil, url.password == nil, url.port == nil else { return nil }
        let name = String(url.path.dropFirst())
        guard allowed.contains(name), !name.split(separator: "/").contains("..") else { return nil }
        return name
    }
}
