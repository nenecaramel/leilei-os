import Foundation

var checks = 0
func expect(_ value: @autoclosure () -> Bool, _ name: String) { precondition(value(), name); checks += 1 }
func rejects(_ name: String, _ work: () throws -> Void) {
    do { try work(); preconditionFailure(name) } catch { checks += 1 }
}
func loaded(_ source: String) -> NativeLiveLoadedAttachment {
    let data = Data(source.utf8)
    return .init(data:data,key:.init(scope:"user:conversation",attachmentID:"svg",sizeBytes:data.count,sha256:NativeLiveAttachmentIntegrity.sha256(data)))
}
let projected = NativeLiveMessagePresentationProjector.project(.streaming("$$x^2$$\n\n```mermaid\ngraph TD\nA-->B\n```"))
let math = projected.nodes[0].children[0], mermaid = projected.nodes[0].children[1]
expect(NativeLiveMessageRendererRegistry.renderer(for:math) == .mathVisual, "display Math full visual dispatch")
expect(NativeLiveMessageRendererRegistry.renderer(for:mermaid) == .mermaid, "Mermaid dispatch")
let inline = NativeLiveMessagePresentationProjector.project(.streaming("before $2x$ after")).nodes[0].children[0]
expect(inline.rendersInlineChildren && inline.children[1].math?.isDisplay == false, "inline wrapping remains native fallback")
expect(NativeLiveMessageRendererRegistry.renderer(for:inline.children[1]) == .math, "inline Math native fallback renderer")
let native: Set<NativeLiveVisualNodeKind> = [.text,.markdown,.code,.table,.diff,.math,.mermaid,.attachment,.canonicalToolResult,.structuredJSON,.searchResult,.citation]
for kind in NativeLiveVisualNodeKind.allCases {
    expect((NativeLiveMessageRendererRegistry.renderer(for:kind) == .fallback) == !native.contains(kind), "explicit kind decision \(kind)")
}
for kind in [NativeLiveVisualNodeKind.artifact,.resource,.webArtifact,.interactiveResource,.chart,.diagram,.unknown,.svg] {
    var node = math; node.kind = kind
    expect(NativeLiveMessageRendererRegistry.renderer(for:node) == .fallback, "F/future cannot enter visual input \(kind)")
}
let equation = try! NativeLiveVisualSandboxInput.displayMath(.init(latex:#"\frac{1}{2}+\sqrt{x}+\sum_i a_i"#,isDisplay:true))
expect(equation.kind == .math && equation.source.hasPrefix(#"\frac"#), "typed Math and raw copy")
rejects("inline Math not WebView") { _ = try NativeLiveVisualSandboxInput.displayMath(.init(latex:"x",isDisplay:false)) }
let inlineEquation = try! NativeLiveVisualSandboxInput.inlineMath(.init(latex:#"\frac{1}{2}"#,isDisplay:false))
expect(inlineEquation.kind == .math && inlineEquation.identity.hasPrefix("inline:"), "inline Math visual input")
rejects("display Math is not inline") { _ = try NativeLiveVisualSandboxInput.inlineMath(.init(latex:"x",isDisplay:true)) }
rejects("empty Math") { _ = try NativeLiveVisualSandboxInput.displayMath(.init(latex:"",isDisplay:true)) }
rejects("huge Math") { _ = try NativeLiveVisualSandboxInput.displayMath(.init(latex:String(repeating:"x",count:8193),isDisplay:true)) }
let diagram = try! NativeLiveVisualSandboxInput.mermaid(.init(info:"mermaid",code:"graph TD\nA-->B",closed:false))
expect(diagram.kind == .mermaid && diagram.source == "graph TD\nA-->B", "typed streaming Mermaid source")
for source in ["",String(repeating:"x",count:20001),"%%{init:{securityLevel:'loose'}}%%\ngraph TD","---\nconfig:\n---\ngraph TD","graph TD\nclick A callback"] {
    rejects("Mermaid bounds/config/click") { _ = try NativeLiveVisualSandboxInput.mermaid(.init(info:"mermaid",code:source,closed:true)) }
}
expect(equation.identity == (try! NativeLiveVisualSandboxInput.displayMath(.init(latex:equation.source,isDisplay:true))).identity, "deterministic source hash")
let good = loaded("<svg viewBox=\"0 0 200 100\"><rect width=\"200\" height=\"100\" fill=\"red\"/><text x=\"1\" y=\"2\">A &amp; B</text></svg>")
let sanitized = try! NativeLiveSVGSanitizer.sanitize(good)
expect(sanitized.aspectRatio == 2 && sanitized.source.contains("A &amp; B"), "valid SVG aspect and escaped text")
expect((try! NativeLiveVisualSandboxInput.svg(good)).identity == good.key.imageKey, "SVG cache identity is integrity + scoped attachment")
let input = NativeLiveAttachmentPresentationInput(entityID:"svg",draftID:"draft",filename:"drawing.svg",mimeType:"image/svg+xml",kind:"file",materialization:"ready")
expect(NativeLiveMessageRendererRegistry.renderer(for:input) == .svgAttachment, "C SVG attachment dispatch")
for malicious in ["<svg><script>alert(1)</script></svg>","<svg onload=\"alert(1)\"/>","<svg><image href=\"https://example.com/x\"/></svg>","<svg><use href=\"file:///etc/passwd\"/></svg>","<svg><foreignObject/></svg>","<svg><style>@import 'x'</style></svg>","<svg style=\"fill:red\"/>","<svg><animate/></svg>","<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg>&x;</svg>","<svg><path fill=\"url(https://example.com)\"/></svg>","<svg xmlns=\"evil\"/>","<svg",String(repeating:"x",count:256001),"<svg><path d=\""+String(repeating:"1",count:16385)+"\"/></svg>"] {
    rejects("unsafe/oversized SVG") { _ = try NativeLiveSVGSanitizer.sanitize(loaded(malicious)) }
}
rejects("SVG integrity before rendering") { _ = try NativeLiveVisualSandboxInput.svg(.init(data:Data("changed".utf8),key:good.key)) }
let reference = try! NativeLiveSVGSanitizer.sanitize(loaded("<svg><defs><path id=\"p\" d=\"M0 0 L1 1\"/></defs><use href=\"#p\"/></svg>"))
expect(reference.source.contains("href=\"#p\""), "local static SVG refs allowed")
var state = NativeLiveVisualRenderState()
let first = state.begin(now:10)
expect(state.phase == .loading && state.deadline == 18, "loading deadline")
expect(!state.receive(["event":"ready","generation":first-1]), "stale ready ignored")
for bad in [Double.nan,Double.infinity,-1.0] { expect(!state.receive(["event":"contentHeight","generation":first,"height":bad]), "invalid height ignored") }
expect(!state.receive(["event":"contentHeight","generation":first,"height":"big"]), "height string rejected")
expect(!state.receive(["event":"ready","generation":NSNumber(value:true)]), "Boolean generation rejected")
expect(!state.receive(["event":"contentHeight","generation":first,"height":NSNumber(value:true)]), "Boolean height rejected")
expect(state.receive(["event":"contentHeight","generation":first,"height":1e12]) && state.inlineHeight == 480, "absurd height clamped")
expect(state.receive(["event":"ready","generation":first]) && state.phase == .ready, "ready protocol")
let second = state.begin(now:20)
expect(state.inlineHeight == 480, "update preserves bounded prior height")
expect(!state.receive(["event":"contentHeight","generation":first,"height":44.0]), "stale height ignored")
expect(!state.receive(["event":"filesystem","generation":second]), "no arbitrary native methods")
expect(!state.receive(["event":"ready","generation":second,"payload":"evil"]), "unknown bridge field rejected")
state.tick(now:27.99); expect(state.phase == .loading, "before timeout")
state.tick(now:28); expect(state.phase == .failed && state.error != nil, "deterministic timeout fallback")
expect(!state.receive(["event":"ready","generation":second]), "timed-out work cannot resurrect")
let third = state.begin(now:30)
expect(state.receive(["event":"renderError","generation":third,"message":"Parse failure"]) && state.phase == .failed, "render error visible")
let fourth = state.begin(now:40)
expect(state.receive(["event":"ready","generation":fourth]), "retry readiness")
state.cancel(); expect(state.phase == .fallback && !state.receive(["event":"ready","generation":fourth]), "cancel drops stale work")
let document = NativeLiveVisualNavigationPolicy.documentURL
expect(NativeLiveVisualNavigationPolicy.allowsInitialDocument(document,isInitial:true,isMainFrame:true), "renderer document only")
expect(!NativeLiveVisualNavigationPolicy.allowsInitialDocument(document,isInitial:false,isMainFrame:true), "no repeated navigation")
expect(!NativeLiveVisualNavigationPolicy.allowsInitialDocument(document,isInitial:true,isMainFrame:false), "no frames")
for url in ["https://example.com","file:///tmp/x","ui://app","data:text/html,hi","javascript:1","leilei-visual://bundle/evil.html"] {
    expect(!NativeLiveVisualNavigationPolicy.allowsInitialDocument(URL(string:url),isInitial:true,isMainFrame:true), "deny navigation \(url)")
}
expect(NativeLiveVisualNavigationPolicy.resourceName(URL(string:"leilei-visual://bundle/katex.js"),allowed:["katex.js"]) == "katex.js", "allowlisted asset")
for url in ["leilei-visual://bundle/../secret","leilei-visual://bundle/katex.js?x=1","leilei-visual://other/katex.js","file:///katex.js","https://example.com/katex.js"] {
    expect(NativeLiveVisualNavigationPolicy.resourceName(URL(string:url),allowed:["katex.js"]) == nil, "deny resource \(url)")
}
let dimensionOnly = try! NativeLiveSVGSanitizer.sanitize(loaded("<svg width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>"))
expect(dimensionOnly.source.contains("viewBox=\"0 0 200.0 100.0\""),"dimensions normalize to a scalable viewBox")
rejects("invalid viewBox falls back") { _ = try NativeLiveSVGSanitizer.sanitize(loaded("<svg viewBox=\"0 0 NaN 20\"/>")) }
var svgLoading = NativeLiveSVGLoadingState()
let olderLoad = svgLoading.begin()
let newerLoad = svgLoading.begin()
svgLoading.complete(good,generation:newerLoad)
let newerIdentity = svgLoading.input?.identity
svgLoading.cancel(generation:olderLoad)
svgLoading.fail("old failure",generation:olderLoad)
svgLoading.complete(loaded("<svg/>"),generation:olderLoad)
expect(svgLoading.input?.identity == newerIdentity && svgLoading.error == nil && !svgLoading.loading,"stale SVG load cannot clear newer preview")
let invalidLoad = svgLoading.begin()
svgLoading.complete(.init(data:Data("changed".utf8),key:good.key),generation:invalidLoad)
expect(svgLoading.input == nil && svgLoading.verified == nil && svgLoading.error != nil,"unverified original cannot render or open")
let unsafeLoad = svgLoading.begin()
svgLoading.complete(loaded("<svg><script/></svg>"),generation:unsafeLoad)
expect(svgLoading.input == nil && svgLoading.verified != nil && svgLoading.error != nil,"unsafe SVG preserves verified file fallback")
print("Visual renderer PASS: \(checks) real Swift assertions")
