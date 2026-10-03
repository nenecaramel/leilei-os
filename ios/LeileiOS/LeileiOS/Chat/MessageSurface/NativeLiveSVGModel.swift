import Foundation

struct NativeLiveSanitizedSVG: Equatable {
    let source: String
    let aspectRatio: Double
}

// Reject unsupported capabilities instead of trying to repair active SVG. No CSS, images,
// entities, foreignObject, scripts/events/animation or external references enter WebKit.
enum NativeLiveSVGSanitizer {
    static func sanitize(_ loaded: NativeLiveLoadedAttachment) throws -> NativeLiveSanitizedSVG {
        try NativeLiveAttachmentIntegrity.verify(loaded.data, key: loaded.key)
        guard loaded.data.count <= 256_000, let source = String(data: loaded.data, encoding: .utf8),
              !source.uppercased().contains("<!DOCTYPE"), !source.uppercased().contains("<!ENTITY") else { throw NativeLiveVisualError.unsafeSVG }
        let delegate = SVGDelegate()
        let parser = XMLParser(data: loaded.data)
        parser.shouldResolveExternalEntities = false; parser.delegate = delegate
        guard parser.parse(), !delegate.failed, delegate.output.utf8.count <= 512_000, delegate.stack.isEmpty, delegate.hasRoot else { throw NativeLiveVisualError.unsafeSVG }
        return .init(source: delegate.output, aspectRatio: delegate.ratio)
    }
}

private final class SVGDelegate: NSObject, XMLParserDelegate {
    var failed = false, hasRoot = false
    var output = "", stack: [String] = [], count = 0
    var ratio: Double = 1
    private let tags: Set<String> = ["svg","g","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","defs","clipPath","linearGradient","radialGradient","stop","use","title","desc"]
    private let attributes: Set<String> = ["id","xmlns","xmlns:xlink","viewBox","width","height","x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","d","points","transform","fill","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-dasharray","stroke-dashoffset","fill-rule","clip-rule","opacity","fill-opacity","stroke-opacity","clip-path","offset","stop-color","stop-opacity","gradientUnits","gradientTransform","href","xlink:href","font-size","font-family","font-weight","text-anchor","dx","dy","preserveAspectRatio"]
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes values: [String: String]) {
        count += 1
        guard !failed, count <= 2048, stack.count < 32, tags.contains(name), values.count <= 40,
              (hasRoot || name == "svg"), !(stack.isEmpty && hasRoot) else { reject(parser); return }
        if !hasRoot { hasRoot = true }
        var encoded: [String] = []
        for (key, value) in values.sorted(by: { $0.key < $1.key }) {
            guard attributes.contains(key), value.utf8.count <= (key == "d" || key == "points" ? 16_384 : 512),
                  !value.contains("<"), !value.contains(">"), !value.lowercased().contains("javascript:"), !value.contains("\\") else { reject(parser); return }
            if key == "xmlns" {
                guard value == "http://www.w3.org/2000/svg" else { reject(parser); return }
            } else if key == "xmlns:xlink" {
                guard value == "http://www.w3.org/1999/xlink" else { reject(parser); return }
            } else if key == "href" || key == "xlink:href" {
                guard validReference(value) else { reject(parser); return }
            } else if value.lowercased().contains("url") {
                guard value.hasPrefix("url(#"), value.hasSuffix(")"), validReference(String(value.dropFirst(4).dropLast())) else { reject(parser); return }
            } else {
                guard !value.contains(":"), !value.contains("@"), !value.contains(";") else { reject(parser); return }
            }
            encoded.append("\(key)=\"\(escape(value))\"")
        }
        if name == "svg", stack.isEmpty {
            if values["xmlns"] == nil { encoded.append("xmlns=\"http://www.w3.org/2000/svg\"") }
            if let rawBox = values["viewBox"] {
                let parts = rawBox.split(whereSeparator: { $0.isWhitespace || $0 == "," })
                let box = parts.compactMap { Double($0) }
                guard parts.count == 4, box.count == 4, box.allSatisfy(\.isFinite), box[2] > 0, box[3] > 0 else { reject(parser); return }
                ratio = min(100,max(0.01,box[2]/box[3]))
            } else {
                // A fitted viewport must scale coordinates rather than crop a width/height-only SVG.
                let width = values["width"].flatMap(Double.init) ?? (values["width"] == nil ? 300 : 0)
                let height = values["height"].flatMap(Double.init) ?? (values["height"] == nil ? 150 : 0)
                guard width.isFinite, height.isFinite, width > 0, height > 0 else { reject(parser); return }
                encoded.append("viewBox=\"0 0 \(width) \(height)\"")
                ratio = min(100,max(0.01,width/height))
            }
        }
        output += "<\(name)\(encoded.isEmpty ? "" : " "+encoded.joined(separator:" "))>"; stack.append(name)
    }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        guard !failed, stack.last == name else { reject(parser); return }
        output += "</\(name)>"; stack.removeLast()
    }
    func parser(_ parser: XMLParser, foundCharacters text: String) { if !failed { output += escape(text) } }
    func parser(_ parser: XMLParser, foundCDATA data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { reject(parser); return }
        if !failed { output += escape(text) }
    }
    func parser(_ parser: XMLParser, resolveExternalEntityName name: String, systemID: String?) -> Data? { reject(parser); return nil }
    private func reject(_ parser: XMLParser) { failed = true; parser.abortParsing() }
    private func validReference(_ value: String) -> Bool {
        value.hasPrefix("#") && value.count > 1 && value.dropFirst().allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
    }
    private func escape(_ value: String) -> String {
        value.replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"<",with:"&lt;").replacingOccurrences(of:">",with:"&gt;").replacingOccurrences(of:"\"",with:"&quot;")
    }
}

// Generation-gated loader state is shared by the UI and deterministic Swift regressions.
// An older cancelled download cannot clear or overwrite a newer attachment's preview.
struct NativeLiveSVGLoadingState {
    private(set) var generation = 0
    private(set) var input: NativeLiveVisualSandboxInput?
    private(set) var verified: NativeLiveLoadedAttachment?
    private(set) var error: String?
    private(set) var loading = false
    mutating func begin() -> Int {
        generation += 1; input = nil; verified = nil; error = nil; loading = true
        return generation
    }
    mutating func complete(_ bytes: NativeLiveLoadedAttachment, generation token: Int) {
        guard token == generation else { return }
        do {
            try NativeLiveAttachmentIntegrity.verify(bytes.data,key:bytes.key)
            verified = bytes
            input = try NativeLiveVisualSandboxInput.svg(bytes)
            loading = false
        } catch { fail("SVG preview unavailable. Open the verified file.",generation:token) }
    }
    mutating func fail(_ message: String, generation token: Int) {
        guard token == generation else { return }
        input = nil; loading = false; error = message
    }
    mutating func cancel(generation token: Int) {
        guard token == generation else { return }
        input = nil; verified = nil; loading = false
    }
}
