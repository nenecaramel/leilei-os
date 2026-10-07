import Foundation
import AppKit
import WebKit

actor FetchCounter {
    var count = 0
    func fetch(_ data: Data) -> Data { count += 1; return data }
}

@main struct VisualFixture {
    @MainActor static func main() async {
        _ = NSApplication.shared
        var checks = 0
        func expect(_ value: @autoclosure () -> Bool, _ name: String) { precondition(value(),name); checks += 1 }
        let controller = NativeLiveVisualSandboxController(assetsRoot:URL(fileURLWithPath:CommandLine.arguments[1]))
        let window = NSWindow(contentRect:NSRect(x:0,y:0,width:640,height:480),styleMask:[.titled],backing:.buffered,defer:false)
        func awaitRender() async {
            if let web = controller.view { window.contentView = web }
            let deadline = Date().addingTimeInterval(12)
            while controller.state.phase == .loading && Date() < deadline { try? await Task.sleep(nanoseconds:20_000_000) }
            expect(controller.state.phase != .loading,"renderer must settle")
        }
        func math(_ source: String, dark: Bool = false) async {
            controller.update(try! .displayMath(.init(latex:source,isDisplay:true)),dark:dark,scale:1)
            await awaitRender()
        }
        func diagram(_ source: String, dark: Bool = false) async {
            controller.update(try! .mermaid(.init(info:"mermaid",code:source,closed:true)),dark:dark,scale:1)
            await awaitRender()
        }
        await math(#"\frac{1}{2}+x^2+\sqrt{y}+\alpha+\int_0^1 x dx"#)
        expect(controller.state.phase == .ready,"actual local KaTeX success: \(controller.state.error ?? "pending")")
        let original = controller.view!
        expect(!original.configuration.websiteDataStore.isPersistent,"nonpersistent WebKit")
        let fraction = try! await original.evaluateJavaScript("document.querySelectorAll('.katex .mfrac').length") as! Int
        expect(fraction > 0,"real typeset fraction DOM")
        expect(controller.state.inlineHeight >= 44 && controller.state.inlineHeight <= 480,"real bounded height bridge")
        await math(#"\begin{pmatrix}1&2\\3&4\end{pmatrix}+\sum_i a_i"#,dark:true)
        expect(controller.state.phase == .ready && controller.view === original,"same WebView theme/source update")
        let color = try! await original.evaluateJavaScript("getComputedStyle(document.body).color") as! String
        expect(color.contains("238"),"actual dark theme")
        await math(#"\undefinedLeileiCommand"#)
        expect(controller.state.phase == .failed && controller.state.error != nil,"invalid LaTeX fails visibly")
        await math("x^2")
        expect(controller.state.phase == .ready,"retry after failure")
        await diagram("graph TD\nA-->B")
        expect(controller.state.phase == .ready,"actual graph: \(controller.state.error ?? "pending")")
        let diagramView = controller.view!
        let svg = try! await diagramView.evaluateJavaScript("document.querySelectorAll('#visual>svg').length") as! Int
        expect(svg == 1,"actual Mermaid SVG DOM")
        await diagram("sequenceDiagram\nAlice->>Bob: Hello",dark:true)
        expect(controller.state.phase == .ready && controller.view === diagramView,"actual sequence + dark theme + reuse: \(controller.state.error ?? "pending")")
        await diagram("graph TD\nA-->")
        expect(controller.state.phase == .failed,"invalid Mermaid has source fallback state")
        await diagram("graph TD\nA-->B")
        let reused = controller.view!
        controller.update(try! .mermaid(.init(info:"mermaid",code:"graph TD\nA-->C",closed:false)),dark:false,scale:1)
        controller.update(try! .mermaid(.init(info:"mermaid",code:"graph TD\nA-->Latest",closed:true)),dark:false,scale:1)
        await awaitRender()
        expect(controller.state.phase == .ready && controller.view === reused,"coalesced streaming reuses view")
        let current = try! await reused.evaluateJavaScript("document.getElementById('visual').textContent") as! String
        expect(current.contains("Latest") && !current.contains("A-->C"),"latest source wins")
        let bytes = Data("<svg viewBox=\"0 0 200 100\"><rect width=\"200\" height=\"100\" fill=\"red\"/></svg>".utf8)
        let loaded = NativeLiveLoadedAttachment(data:bytes,key:.init(scope:"test",attachmentID:"svg",sizeBytes:bytes.count,sha256:NativeLiveAttachmentIntegrity.sha256(bytes)))
        let cache = NativeLiveAttachmentBytesCache()
        let counter = FetchCounter()
        let inlineBytes = try! await cache.bytes(key:loaded.key) { await counter.fetch(bytes) }
        let fullscreenBytes = try! await cache.bytes(key:loaded.key) { await counter.fetch(bytes) }
        let fetchCount = await counter.count
        expect(fetchCount == 1 && inlineBytes == fullscreenBytes,"SVG inline/fullscreen reuse C original cache")
        let badKey = NativeLiveAttachmentCacheKey(scope:"test",attachmentID:"bad",sizeBytes:bytes.count,sha256:String(repeating:"0",count:64))
        do { _ = try await cache.bytes(key:badKey) { bytes }; expect(false,"bad SHA must fail") }
        catch { expect(true,"C rejects bad integrity before SVG") }
        controller.update(try! .svg(loaded),dark:false,scale:2)
        await awaitRender()
        expect(controller.state.phase == .ready,"actual verified SVG")
        let web = controller.view!
        let box = try! await web.evaluateJavaScript("document.querySelector('#visual>svg').viewBox.baseVal.width/document.querySelector('#visual>svg').viewBox.baseVal.height") as! Double
        expect(box == 2,"SVG aspect ratio")
        let dimensionBytes = Data("<svg width=\"200\" height=\"100\"><rect x=\"100\" width=\"100\" height=\"100\"/></svg>".utf8)
        let dimensionLoaded = NativeLiveLoadedAttachment(data:dimensionBytes,key:.init(scope:"test",attachmentID:"dimensions",sizeBytes:dimensionBytes.count,sha256:NativeLiveAttachmentIntegrity.sha256(dimensionBytes)))
        controller.update(try! .svg(dimensionLoaded),dark:false,scale:1)
        await awaitRender()
        let fitted = try! await web.evaluateJavaScript("document.getElementById('visual').style.width='80px'; const s=document.querySelector('#visual>svg'); const r=s.querySelector('rect'); const sb=s.getBoundingClientRect(),rb=r.getBoundingClientRect(); ({viewWidth:sb.width,rectRight:rb.right-svgLeft(sb),ratio:sb.width/sb.height}); function svgLeft(b){return b.left;}") as! [String:Double]
        expect(fitted["viewWidth"]! <= 80 && fitted["rectRight"]! <= fitted["viewWidth"]!+1 && abs(fitted["ratio"]!-2)<0.01,"width/height-only SVG scales coordinates without cropping")
        let blocked = try! await web.callAsyncJavaScript("window.violations=[]; document.addEventListener('securitypolicyviolation',e=>window.violations.push(e.violatedDirective)); try { await fetch(url) } catch {} await new Promise(r=>setTimeout(r,50)); return window.violations.includes('connect-src');",arguments:["url":"https://example.com/forbidden"],in:nil,contentWorld:.page) as! Bool
        expect(blocked,"real CSP network denial")
        web.load(URLRequest(url:URL(string:"https://example.com/forbidden-navigation")!))
        try? await Task.sleep(nanoseconds:150_000_000)
        expect(web.url == NativeLiveVisualNavigationPolicy.documentURL,"real navigation denied")
        let popup = try! await web.evaluateJavaScript("window.open('https://example.com')===null") as! Bool
        expect(popup,"window.open denied")
        let generation = controller.state.generation
        _ = try! await web.callAsyncJavaScript("window.webkit.messageHandlers.visual.postMessage({event:'contentHeight',generation:token,height:999999});",arguments:["token":generation-1],in:nil,contentWorld:.page)
        try? await Task.sleep(nanoseconds:50_000_000)
        expect(controller.state.inlineHeight < 480,"stale real height message ignored")
        controller.webViewWebContentProcessDidTerminate(web)
        expect(controller.state.phase == .failed && controller.view == nil,"content-process failure fallback and release")
        controller.update(try! .displayMath(.init(latex:"x",isDisplay:true)),dark:false,scale:1)
        await awaitRender()
        expect(controller.state.phase == .ready,"process recovery retry")
        controller.stop()
        expect(controller.view == nil && controller.state.phase == .fallback,"disappear cancellation cleanup")
        let owners = (0..<13).map { _ in NativeLiveVisualSandboxController(assetsRoot:URL(fileURLWithPath:CommandLine.arguments[1])) }
        let equation = try! NativeLiveVisualSandboxInput.displayMath(.init(latex:"x",isDisplay:true))
        owners.forEach { $0.update(equation,dark:false,scale:1) }
        expect(owners.prefix(12).allSatisfy { $0.view != nil },"bounded live view slots")
        expect(owners[12].view == nil && owners[12].state.phase == .failed,"thirteenth view falls back visibly")
        owners[0].stop()
        owners[12].update(equation,dark:false,scale:1,retry:1)
        expect(owners[12].view != nil,"released capacity can retry")
        owners.forEach { $0.stop() }
        print("Visual WebKit PASS: \(checks) real engine/host assertions")
    }
}
