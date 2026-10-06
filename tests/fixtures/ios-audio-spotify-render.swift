import SwiftUI
import UIKit
import CryptoKit

private struct Stage6ScopeKey: EnvironmentKey { static let defaultValue = "" }
extension EnvironmentValues { var stage6Scope: String { get { self[Stage6ScopeKey.self] } set { self[Stage6ScopeKey.self] = newValue } } }
struct Stage6Frames: PreferenceKey {
    static var defaultValue: [String: CGRect] { [:] }
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue()) { _, n in n } }
}
extension View {
    func stage6Frame(_ name: String) -> some View {
        background(GeometryReader { geometry in Color.clear.preference(key: Stage6Frames.self, value: [name: geometry.frame(in: .global)]) })
    }
}
@MainActor enum Stage6Probe {
    static var actions: [String: () -> Void] = [:]
    static var activeScope = ""
    static var image: UIImage?
    static var loads = 0
    static var coversLoaded = 0
    static var previewCreations = 0
    static var mode = "ok"
    static var lease: (() -> NativeLiveFilePreviewLease?)?
    static var dismiss: (() -> Void)?
    static var urls: [String] = []
    static var resolved: [String] = []
    static func capture(_ key: String, scope: String, _ action: @escaping () -> Void) -> () -> Void { actions[scope+key] = action; return action }
    static func click(_ key: String) async {
        precondition(actions[activeScope+key] != nil, "Missing compiled button \(key)")
        actions[activeScope+key]?(); try? await Task.sleep(for: .milliseconds(200))
    }
    static func bytes(_ input: NativeLiveAttachmentPresentationInput) async throws -> NativeLiveLoadedAttachment {
        loads += 1; try await Task.sleep(for: .milliseconds(30))
        if mode == "integrity" { throw NativeLiveMediaError.integrityFailed }
        if mode == "download" { throw NativeLiveMediaError.downloadFailed }
        return .init(data: wav(), key: .init(scope: "fixture", attachmentID: "audio", sizeBytes: wav().count, sha256: NativeLiveAttachmentIntegrity.sha256(wav())))
    }
    static func wav() -> Data {
        let count = 16000; var data = Data()
        func u16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        func u32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        data.append(Data("RIFF".utf8)); u32(UInt32(36+count*2)); data.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1); u32(8000); u32(16000); u16(2); u16(16); data.append(Data("data".utf8)); u32(UInt32(count*2)); data.append(Data(count: count*2)); return data
    }
    static func reset() { actions = [:]; loads = 0; coversLoaded = 0; previewCreations = 0; mode = "ok"; lease = nil; dismiss = nil; urls = []; resolved = [] }
}
@MainActor enum Stage6Fixtures {
    static let voice = ["short-collapsed","medium-collapsed","long-collapsed","short-expanded","long-expanded"]
    static let audio = ["1s","8s","30s","idle","loading","ready","playing","paused","near-end","finished","failed","unavailable","integrity","short","long","uploading"]
    static let spotify = ["one","five","long","currently","empty","error","no-url","cover","bad-cover","permission"]
    static let ordinary = ["png","jpeg","gif","webp","sticker","svg","pdf","text","binary","tool","unknown-spotify","malformed","running","permission"]
    static func input(_ kind: String) -> NativeLiveAttachmentPresentationInput {
        let mime: String
        switch kind {
        case "png": mime = "image/png"
        case "jpeg": mime = "image/jpeg"
        case "gif": mime = "image/gif"
        case "webp", "sticker": mime = "image/webp"
        case "svg": mime = "image/svg+xml"
        case "pdf": mime = "application/pdf"
        case "text": mime = "text/plain"
        case "binary": mime = "application/octet-stream"
        default: mime = "audio/wav"
        }
        return .init(entityID: "attachment", draftID: "attachment", filename: kind == "sticker" ? "meme_0003.webp" : "fixture.\(kind)", mimeType: mime, kind: "file", materialization: kind == "unavailable" ? "unavailable" : kind == "integrity" ? "integrity_failed" : kind == "failed" ? "failed" : kind == "uploading" ? "uploading" : "ready")
    }
    static func state(_ name: String) -> NativeLiveAudioPlaybackState {
        let state = NativeLiveAudioPlaybackState()
        switch name {
        case "loading": state.phase = .loading
        case "playing", "near-end": state.phase = .playing
        case "paused": state.phase = .paused
        case "1s", "8s", "30s", "ready", "finished", "short", "long": state.phase = .ready
        case "failed": state.phase = .failed; state.error = "Could not play audio. Try again."
        default: break
        }
        if ["1s","8s","30s","ready","playing","paused","near-end","finished","short","long"].contains(name) {
            state.duration = name == "1s" ? 1 : name == "8s" ? 8 : name == "30s" ? 30 : name == "short" ? 0.8 : name == "long" ? 3661 : 62
            state.currentTime = name == "finished" ? 62 : name == "near-end" ? 61 : name == "paused" || name == "playing" ? 15 : 0
        }
        return state
    }
    static func output(_ name: String) -> NativeLiveJSONValue {
        if name == "currently" { return .object(["currently_playing_entity": output("one").objectValue!["entities"]!.arrayValue!.first!]) }
        if name == "empty" { return .object(["currently_playing_entity": .null]) }
        if name == "error" { return .object(["is_error": .bool(true), "error": .object(["title": .string("Provider error"), "message": .string("Exact Spotify provider cause"), "error_code": .string("E42")])]) }
        if name == "malformed" { return .object(["entities": .string("not an array")]) }
        let types = name == "five" ? ["track","album","playlist","show","audiobook"] : ["track"]
        return .object(["entities": .array(types.enumerated().map { index, type in
            var entity: [String: NativeLiveJSONValue] = ["name": .string(name == "long" ? String(repeating: "Long song title ", count: 30) : "\(type) \(index)"), "uri": .string("spotify:\(type):id\(index)"), "entity_type": .string(type), "creators": .array([.object(["name": .string(name == "long" ? String(repeating: "Long creator ", count: 30) : "Fixture creator")])]), "parent": .object(["name": .string("Fixture album")])]
            if name != "no-url" { entity["url"] = .string("https://open.spotify.com/\(type)/id\(index)") }
            if name == "cover" || name == "bad-cover" { entity["display"] = .object(["covers": .array([.object(["size": .string("DEFAULT"), "url": .string("http://127.0.0.1:18766/\(name == "cover" ? "cover.png" : "missing.png")")])])]) }
            return .object(entity)
        })])
    }
    static func tool(_ name: String) -> NativeLiveTurnActivityProjection.ToolActivity {
        .init(id: "tool", toolName: "Spotify search", providerToolName: name == "tool" || name == "permission" ? "Read" : name == "unknown-spotify" ? "mcp__Spotify__future" : ["empty","currently"].contains(name) ? "mcp__Spotify__get_currently_playing" : "mcp__Spotify__search", questionMetadata: nil, input: .object(["query": .string("fixture")]), output: output(name), resourceLinks: [], parentToolUseID: nil, parentAgentID: nil, hiddenFromTranscript: false, hiddenFromActivity: false, state: name == "running" ? .running : .completed, order: 1)
    }
    static var sdkTool: NativeLiveTurnActivityProjection.ToolActivity {
        let root=try! JSONDecoder().decode(NativeLiveJSONValue.self,from:Data(contentsOf:URL(fileURLWithPath:Bundle.main.path(forResource:"spotify-sdk-output",ofType:"json")!))).objectValue!["expected"]!.objectValue!
        return .init(id:"sdk-search",toolName:"Spotify search",providerToolName:root["providerToolName"]!.stringValue!,questionMetadata:nil,input:nil,output:root["output"],resourceLinks:[],parentToolUseID:nil,parentAgentID:nil,hiddenFromTranscript:false,hiddenFromActivity:false,state:.completed,order:1)
    }
    static var permission: NativeLiveRuntimeInteractionSnapshot {
        .init(interactionID: "permission", prepareID: "prepare", kind: "permission", request: ["toolName": .string("Read"), "description": .string("Read fixture"), "toolUseId": .string("tool")], status: "pending", response: nil, createdAt: "", updatedAt: "", resolvedAt: nil, cancelledAt: nil)
    }
}
struct Stage6Host: View {
    let scope = UUID().uuidString
    let name: String, baseline: Bool
    let state: NativeLiveAudioPlaybackState
    let model = AppModel()
    var body: some View {
        Group {
            if name.hasPrefix("voice-") {
                let text = String(repeating: "语", count: name.contains("short") ? 1 : name.contains("medium") ? 15 : 240)
                let message = NativeLiveCurrentPathMessage(id:"voice",conversationId:"fixture",parentMessageId:nil,role:"user",status:"completed",createdAt:"",completedAt:nil,blocks:[.init(id:"text",ordinal:0,kind:"text",rawType:"text",text:text,payload:["input_mode":.string("voice")],createdAt:"")])
                HStack(spacing: 0) {
                    Spacer(minLength: ChatPresentationLayout.userLeadingClearance)
                    NativeLiveUserMessagePresentationView(presentation:NativeLiveMessagePresentationProjector.project(.canonical(message)),isVoiceTranscriptRevealed:.constant(name.hasSuffix("expanded")))
                }
            } else if name.hasPrefix("audio-") {
                NativeLiveAudioAttachmentBubble(stage6Input: Stage6Fixtures.input(String(name.dropFirst(6))), state: state)
            } else if name == "spotify-sdk-row" {
                NativeLiveSpotifyResultSurface(items: NativeLiveSpotifyResultSurfaceProjector.project(tools: [Stage6Fixtures.sdkTool]))
            } else if name == "spotify-permission" {
                VStack(alignment: .leading, spacing: ChatPresentationLayout.assistantSpacing) {
                NativeLiveToolActivityRow(tool: Stage6Fixtures.tool("one"), permissionInteractions: [Stage6Fixtures.permission], onResolveInteraction: { interaction, response in
                    Stage6Probe.resolved.append("start:\(interaction.id):\(nativeLiveJSONDetail(.object(response))!)")
                    await Task.yield()
                    Stage6Probe.resolved.append("finish:\(interaction.id)")
                })
                NativeLiveSpotifyResultSurface(items: NativeLiveSpotifyResultSurfaceProjector.project(tools: [Stage6Fixtures.tool("one")]))
                }
            } else if name.hasPrefix("spotify-") {
                let n = String(name.dropFirst(8)), tool = Stage6Fixtures.tool(n)
                NativeLiveSpotifyCard(presentation: NativeLiveSpotifyProjector.project(providerToolName: tool.providerToolName, output: tool.output)!, tool: tool)
            } else if ["tool","unknown-spotify","malformed","running","permission"].contains(name) {
                let tool = Stage6Fixtures.tool(name)
                if baseline { BaselineNativeLiveToolActivityRow(tool: tool, permissionInteractions: name == "permission" ? [Stage6Fixtures.permission] : [], onResolveInteraction: nil) }
                else { NativeLiveToolActivityRow(tool: tool, permissionInteractions: name == "permission" ? [Stage6Fixtures.permission] : [], onResolveInteraction: nil) }
            } else if name == "svg" {
                if baseline { BaselineNativeLiveRegisteredAttachmentView(input: Stage6Fixtures.input(name)) }
                else { NativeLiveRegisteredAttachmentView(input: Stage6Fixtures.input(name)) }
            } else {
                if baseline { BaselineNativeLiveMediaCard(input: Stage6Fixtures.input(name), stickerImage: name == "sticker") }
                else { NativeLiveMediaCard(input: Stage6Fixtures.input(name), stickerImage: name == "sticker") }
            }
        }
        .environment(\.stage6Scope, scope)
        .environmentObject(model)
        .environment(\.openURL, OpenURLAction { url in Stage6Probe.urls.append(url.absoluteString); return .handled })
        .stage6Frame("content")
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.systemBackground))
    }
}
@MainActor final class Stage6FrameStore { var values: [String: CGRect] = [:] }
@MainActor enum Stage6Checks {
    struct Sample { let frames: [String: CGRect]; let pixels: Data; let png: Data }
    static func run(_ scene: UIWindowScene) async {
        let tablet = UIDevice.current.userInterfaceIdiom == .pad, width = tablet ? 1024 : 390, height = 900
        if ProcessInfo.processInfo.environment["STAGE6_BEHAVIOR_ONLY"] == "1" { await behavior(scene,width,height); print("Stage6 render PASS: behavior-only device=\(tablet ? "iPad" : "iPhone")"); fflush(stdout); return }
        let focus=ProcessInfo.processInfo.environment["STAGE6_FOCUS"] ?? ""
        var manifest: [String: Any] = [:], cases = 0, exact = 0
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Stage6Snapshots")
        try! FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        for dark in [false,true] {
            if focus.isEmpty { await voiceGeometry(scene, width, height, dark) }
            for name in (focus.isEmpty ? Stage6Fixtures.ordinary : []) {
                let a = await sample(name, true, scene, width, height, dark), b = await sample(name, false, scene, width, height, dark)
                precondition(a.frames == b.frames, "Non-target geometry changed \(name): \(a.frames) vs \(b.frames)")
                precondition(a.pixels == b.pixels, "Non-target static pixels changed \(name)")
                exact += 1; print("non-target \(name)/\(dark): exact frames + static pixels"); fflush(stdout)
            }
            for name in (Stage6Fixtures.voice.map({ "voice-"+$0 }) + Stage6Fixtures.audio.map({ "audio-"+$0 }) + Stage6Fixtures.spotify.map({ "spotify-"+$0 })).filter({ focus.isEmpty || $0 == focus || $0.hasPrefix(focus + "-") }) {
                let result = await sample(name, false, scene, width, height, dark)
                let key = name + (dark ? "-dark" : "-light")
                manifest[key] = ["frames": result.frames.mapValues { [$0.origin.x,$0.origin.y,$0.size.width,$0.size.height] }, "staticSHA256": SHA256.hash(data: result.pixels).map { String(format: "%02x", $0) }.joined()]
                try! result.png.write(to: output.appendingPathComponent(key+".png")); cases += 1; print("snapshot \(key) frames=\(result.frames.count)"); fflush(stdout)
            }
        }
        try! JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .prettyPrinted]).write(to: output.appendingPathComponent("manifest.json"))
        if focus.isEmpty { await behavior(scene, width, height) }
        print("Stage6 render PASS: \(cases) Audio/Spotify snapshots; \(exact) exact-main non-target cases; device=\(tablet ? "iPad" : "iPhone")"); fflush(stdout)
    }
    static func voiceGeometry(_ scene: UIWindowScene, _ width: Int, _ height: Int, _ dark: Bool) async {
        let short = await sample("voice-short-collapsed", false, scene, width, height, dark)
        let long = await sample("voice-long-collapsed", false, scene, width, height, dark)
        let expandedShort = await sample("voice-short-expanded", false, scene, width, height, dark)
        let expandedLong = await sample("voice-long-expanded", false, scene, width, height, dark)
        // SwiftUI frame arithmetic can differ by ~1e-13pt; no pixel/layout tolerance.
        for key in ["voice-bubble", "voice-controls", "voice-waveform", "voice-chevron"] {
            let frames = [short, long, expandedShort, expandedLong].map { $0.frames[key]! }
            precondition(frames.allSatisfy { abs($0.maxX - frames[0].maxX) < 1e-9 }, "right anchor drift \(key): \(frames)")
            if key == "voice-waveform" || key == "voice-chevron" { precondition(frames.allSatisfy { abs($0.minX - frames[0].minX) < 1e-9 }, "icon drift \(key)") }
        }
        precondition(short.frames["voice-bubble"]!.minX != long.frames["voice-bubble"]!.minX)
        precondition(short.frames["voice-controls"]!.width < long.frames["voice-controls"]!.width)
        precondition(Stage6Probe.loads == 0, "geometry must not download audio")
        print("Voice right anchor PASS: bubble/control right and waveform/chevron X exact; only left extends; collapsed/expanded; dark=\(dark)"); fflush(stdout)
    }
    static func sample(_ name: String, _ baseline: Bool, _ scene: UIWindowScene, _ width: Int, _ height: Int, _ dark: Bool) async -> Sample {
        Stage6Probe.reset()
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        Stage6Probe.image = UIGraphicsImageRenderer(size: CGSize(width: 80, height: 60), format: format).image { c in UIColor.systemBlue.setFill(); c.fill(CGRect(x: 0,y: 0,width: 80,height: 60)) }
        let store = Stage6FrameStore(), state = Stage6Fixtures.state(String(name.dropFirst(6)))
        let host = UIHostingController(rootView: Stage6Host(name: name, baseline: baseline, state: state).environment(\.colorScheme, dark ? .dark : .light).onPreferenceChange(Stage6Frames.self) { store.values = $0 })
        let window = UIWindow(windowScene: scene); window.frame = CGRect(x: 0,y: 0,width: width,height: height); window.overrideUserInterfaceStyle = dark ? .dark : .light; window.rootViewController = host; window.makeKeyAndVisible(); host.view.frame = window.bounds
        host.view.layoutIfNeeded(); try? await Task.sleep(for: .milliseconds(350)); host.view.layoutIfNeeded()
        // Await the real localhost cover response under simulator/build load.
        // The same cover pixels are still compared to the untouched Stage 6 golden.
        if name == "spotify-cover" {
            for _ in 0..<40 where Stage6Probe.coversLoaded == 0 { try? await Task.sleep(for: .milliseconds(50)) }
            host.view.layoutIfNeeded()
        }
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in host.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        var bytes = [UInt8](repeating: 0, count: width*height*4)
        bytes.withUnsafeMutableBytes { raw in CGContext(data: raw.baseAddress,width: width,height: height,bitsPerComponent: 8,bytesPerRow: width*4,space: CGColorSpaceCreateDeviceRGB(),bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!.draw(image.cgImage!, in: window.bounds) }
        var spinners: [CGRect] = []
        func inspect(_ view: UIView) { if view is UIActivityIndicatorView { spinners.append(view.convert(view.bounds,to:host.view)) }; for child in view.subviews { inspect(child) } }
        inspect(host.view)
        var frames=store.values
        if name.hasPrefix("audio-") {
            let input = Stage6Fixtures.input(String(name.dropFirst(6)))
            let expected = NativeLiveVoiceBubbleGeometry.audioWidth(duration: state.duration, sizeBytes: input.sizeBytes)
            precondition(abs(frames["content"]!.width - expected) < 1e-9, "rendered audio width differs from duration rule")
            precondition(frames["play"]!.maxX <= frames["open"]!.minX, "Play and Open overlap")
            precondition(Stage6Probe.loads == 0, "render must never preload bytes for width")
        }
        for (index,frame) in spinners.enumerated() {
            frames["spinner\(index)"] = frame
            let rect=frame.insetBy(dx:-2,dy:-2)
            for y in max(0,Int(rect.minY))..<min(height,Int(ceil(rect.maxY))) { for x in max(0,Int(rect.minX))..<min(width,Int(ceil(rect.maxX))) { for c in 0..<4 { bytes[(y*width+x)*4+c]=0 } } }
        }
        if name == "spotify-cover" { precondition(Stage6Probe.coversLoaded > 0, "Real cover did not load") }
        if name == "spotify-bad-cover" { precondition(Stage6Probe.coversLoaded == 0) }
        let result = Sample(frames: frames,pixels: Data(bytes),png: image.pngData()!)
        window.isHidden = true; host.dismiss(animated: false); try? await Task.sleep(for: .milliseconds(50)); return result
    }
    static func behavior(_ scene: UIWindowScene, _ width: Int, _ height: Int) async {
        Stage6Probe.reset(); let state = NativeLiveAudioPlaybackState()
        let host = UIHostingController(rootView: Stage6Host(name: "audio-idle",baseline:false,state:state))
        let window=UIWindow(windowScene:scene); window.frame=CGRect(x:0,y:0,width:width,height:height); window.rootViewController=host; Stage6Probe.activeScope=host.rootView.scope; window.makeKeyAndVisible(); host.view.frame=window.bounds
        try? await Task.sleep(for:.milliseconds(250))
        await Stage6Probe.click("play")
        precondition(state.phase == .playing && Stage6Probe.loads == 1 && Stage6Probe.lease?() == nil,"Play must only play; never open")
        await Stage6Probe.click("play"); precondition(state.phase == .paused)
        await Stage6Probe.click("play"); precondition(state.phase == .playing && Stage6Probe.loads == 1)
        Stage6Probe.actions[Stage6Probe.activeScope+"open"]?(); Stage6Probe.actions[Stage6Probe.activeScope+"open"]?()
        try? await Task.sleep(for: .milliseconds(250))
        precondition(Stage6Probe.previewCreations == 1, "isOpening must guard rapid taps")
        precondition(Stage6Probe.loads == 1 && host.presentedViewController != nil,"Open must reuse verified bytes and present preview")
        let lease=Stage6Probe.lease?(); precondition(lease != nil && FileManager.default.fileExists(atPath:lease!.fileURL.path))
        Stage6Probe.dismiss?(); host.dismiss(animated:false)
        try? await Task.sleep(for:.milliseconds(250)); precondition(!FileManager.default.fileExists(atPath:lease!.fileURL.path))
        window.isHidden=true; window.rootViewController=nil; state.deactivate()
        for error in ["download","integrity"] {
            Stage6Probe.reset(); Stage6Probe.mode=error
            let state=NativeLiveAudioPlaybackState(), host=UIHostingController(rootView:Stage6Host(name:"audio-idle",baseline:false,state:state))
            window.rootViewController=host; Stage6Probe.activeScope=host.rootView.scope; window.makeKeyAndVisible(); host.view.frame=window.bounds
            try? await Task.sleep(for:.milliseconds(250)); await Stage6Probe.click("play"); precondition(state.phase == .failed, "Expected failed: mode=\(Stage6Probe.mode) phase=\(state.phase) loads=\(Stage6Probe.loads) error=\(String(describing:state.error))")
            Stage6Probe.mode="ok"; await Stage6Probe.click("retry"); precondition(state.phase == .playing && Stage6Probe.loads == 2)
            state.deactivate(); window.isHidden=true; window.rootViewController=nil
        }
        Stage6Probe.reset(); Stage6Probe.mode="preview"
        let previewHost=UIHostingController(rootView:Stage6Host(name:"audio-idle",baseline:false,state:NativeLiveAudioPlaybackState()))
        window.rootViewController=previewHost; Stage6Probe.activeScope=previewHost.rootView.scope; window.makeKeyAndVisible(); previewHost.view.frame=window.bounds
        try? await Task.sleep(for:.milliseconds(250)); await Stage6Probe.click("open")
        precondition(Stage6Probe.lease?() == nil && Stage6Probe.previewCreations == 1)
        Stage6Probe.mode="ok"; await Stage6Probe.click("retry")
        let retried=Stage6Probe.lease?(); precondition(retried != nil && previewHost.presentedViewController != nil && Stage6Probe.previewCreations == 2, "Preview Retry: lease=\(retried != nil) sheet=\(previewHost.presentedViewController != nil) attempts=\(Stage6Probe.previewCreations) loads=\(Stage6Probe.loads)")
        Stage6Probe.dismiss?(); previewHost.dismiss(animated:false); window.isHidden=true; window.rootViewController=nil
        precondition(!FileManager.default.fileExists(atPath:retried!.fileURL.path))
        for name in ["five","no-url"] {
            Stage6Probe.reset()
            let host=UIHostingController(rootView:Stage6Host(name:"spotify-"+name,baseline:false,state:NativeLiveAudioPlaybackState()))
            window.rootViewController=host; Stage6Probe.activeScope=host.rootView.scope; window.makeKeyAndVisible(); host.view.frame=window.bounds; try? await Task.sleep(for:.milliseconds(250))
            if name == "five" {
                for (i,type) in ["track","album","playlist","show","audiobook"].enumerated() { await Stage6Probe.click("url-\(type) \(i)") }
                precondition(Stage6Probe.urls == ["https://open.spotify.com/track/id0","https://open.spotify.com/album/id1","https://open.spotify.com/playlist/id2","https://open.spotify.com/show/id3","https://open.spotify.com/audiobook/id4"])
            } else {
                // Invoke even the disabled closure to prove the nil URL guard.
                await Stage6Probe.click("url-track 0"); precondition(Stage6Probe.urls.isEmpty)
            }
            await Stage6Probe.click("details"); precondition(host.presentedViewController != nil)
            host.dismiss(animated:false); window.isHidden=true
        }
        Stage6Probe.reset()
        let sdkHost=UIHostingController(rootView:Stage6Host(name:"spotify-sdk-row",baseline:false,state:NativeLiveAudioPlaybackState()))
        window.rootViewController=sdkHost; Stage6Probe.activeScope=sdkHost.rootView.scope; window.makeKeyAndVisible(); sdkHost.view.frame=window.bounds
        try? await Task.sleep(for:.milliseconds(250)); await Stage6Probe.click("url-SDK Song")
        precondition(Stage6Probe.urls == ["https://open.spotify.com/track/sdk"], "SDK envelope did not reach standalone result surface")
        await Stage6Probe.click("details"); precondition(sdkHost.presentedViewController != nil)
        sdkHost.dismiss(animated:false); window.isHidden=true; window.rootViewController=nil
        for action in ["allow","deny"] {
            Stage6Probe.reset()
            let host=UIHostingController(rootView:Stage6Host(name:"spotify-permission",baseline:false,state:NativeLiveAudioPlaybackState()))
            window.rootViewController=host; Stage6Probe.activeScope=host.rootView.scope; window.makeKeyAndVisible(); host.view.frame=window.bounds
            try? await Task.sleep(for:.milliseconds(250)); await Stage6Probe.click(action); await Stage6Probe.click(action)
            let payload: [String: NativeLiveJSONValue] = action == "allow" ? ["decision": .string("allow")] : ["decision": .string("deny"),"message": .string("Denied by user in LeileiOS."),"interrupt": .bool(false)]
            precondition(Stage6Probe.resolved == ["start:permission:\(nativeLiveJSONDetail(.object(payload))!)","finish:permission"], "Nested Spotify permission callback changed")
            window.isHidden=true; window.rootViewController=nil
        }
        print("Stage6 behaviors PASS: real Play/Pause/Resume; one download; original lease/sheet/cleanup; download/integrity Retry; five exact URLs; no-URL guard; generic details"); fflush(stdout)
    }
}
final class Stage6AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ app: UIApplication, configurationForConnecting session: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration { let c=UISceneConfiguration(name:"Tests",sessionRole:session.role); c.delegateClass=Stage6SceneDelegate.self; return c }
}
final class Stage6SceneDelegate: NSObject, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene=scene as? UIWindowScene else { return }; window=UIWindow(windowScene:scene); window?.rootViewController=UIViewController(); window?.makeKeyAndVisible()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { Task { await Stage6Checks.run(scene); exit(0) } }
    }
}
@main struct Stage6App { static func main() { UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(Stage6AppDelegate.self)) } }
