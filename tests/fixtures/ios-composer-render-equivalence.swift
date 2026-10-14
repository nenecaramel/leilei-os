import SwiftUI
import UIKit

private struct ChatStaticBackdrop: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues { var chatStaticBackdrop: Bool { get { self[ChatStaticBackdrop.self] } set { self[ChatStaticBackdrop.self] = newValue } } }
private struct ChatGlassComparison<S:Shape>:ViewModifier {
    @Environment(\.chatStaticBackdrop) var staticBackdrop
    let glass:Glass;let shape:S
    @ViewBuilder func body(content:Content)->some View {
        if staticBackdrop { content.background(Color(red:0.2,green:0.5,blue:0.7),in:shape) }
        else { content.glassEffect(glass,in:shape) }
    }
}
extension View { func chatTestGlass<S:Shape>(_ glass:Glass,in shape:S)->some View { modifier(ChatGlassComparison(glass:glass,shape:shape)) } }

struct ChatFrames: PreferenceKey {
    static var defaultValue: [String:CGRect] { [:] }
    static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]) { value.merge(nextValue()) { _,new in new } }
}
extension View {
    func chatFrame(_ name:String) -> some View {
        background(GeometryReader { g in Color.clear.preference(key:ChatFrames.self,value:[name:g.frame(in:.global)]) })
    }
}
@MainActor final class ChatFrameStore { var frames:[String:CGRect] = [:] }
@MainActor enum ChatRenderFixtures {
    static let id = UUID(uuidString:"00000000-0000-0000-0000-000000000123")!
    static var staticPass = false
    static var keyboardShown = false
    static var keyboardFrame: CGRect?
    static var keyboardPresented = false
    static var keyboardDismissed = true
    static func text(_ name:String)->String {
        switch name { case "text","active-text","edit","edit-voice","keyboard","model-label","sending": return "Hello Leilei"
        case "multiline": return "First line\nSecond line\nThird line\nFourth line"
        default:return "" }
    }
    static func attachments(_ name:String)->[NativeLiveComposerAttachmentDraft] {
        guard name.hasPrefix("attachment") || name == "multiple" else {return []}
        let state:NativeLiveComposerAttachmentUploadState = name == "attachment-uploading" ? .uploading : name == "attachment-failed" ? .failed("fixture failure") : .ready("fixture")
        let one=NativeLiveComposerAttachmentDraft(id:id,filename:"fixture.txt",mimeType:"text/plain",kind:.file,data:Data("abc".utf8),state:state)
        if name != "multiple" {return [one]}
        return [one,.init(id:UUID(uuidString:"00000000-0000-0000-0000-000000000124")!,filename:"second.txt",mimeType:"text/plain",kind:.file,data:Data("xyz".utf8),state:.ready("second"))]
    }
    static func model(_ name:String)->AppModel { AppModel() }

}
@MainActor final class ComposerSelectionBox {
    var model:NativeLiveClaudeModel;var thinking:NativeLiveThinkingMode;var effort:NativeLiveEffortLevel
    init(_ model:NativeLiveClaudeModel,_ thinking:NativeLiveThinkingMode,_ effort:NativeLiveEffortLevel) {self.model=model;self.thinking=thinking;self.effort=effort}
    var modelBinding:Binding<NativeLiveClaudeModel> { .init(get:{self.model},set:{self.model=$0}) }
    var thinkingBinding:Binding<NativeLiveThinkingMode> { .init(get:{self.thinking},set:{self.thinking=$0}) }
    var effortBinding:Binding<NativeLiveEffortLevel> { .init(get:{self.effort},set:{self.effort=$0}) }
    var snapshot:[String] { [model.rawValue,thinking.rawValue,effort.rawValue] }
}
@MainActor struct ComposerRenderHost: View {
    let name:String; let baseline:Bool; var rejected=false
    @FocusState var focused:Bool
    var body:some View {
        Group {
            if rejected { RejectedChatComposer(text:.constant(ChatRenderFixtures.text(name)),model:.constant(name == "model-label" ? .sonnet55:.opus55),thinking:.constant(.adaptive),effort:.constant(name == "model-label" ? .xhigh:.high),voiceLanguage:.constant(.english),isFocused:$focused,isSending:name == "sending",isRuntimeTurnActive:name.hasPrefix("active") || name == "interrupt",isRuntimeControlInFlight:name == "control",interruptRequested:name == "interrupt",isEditing:name.hasPrefix("edit"),attachments:ChatRenderFixtures.attachments(name),voiceEnabled:name != "voice-disabled",voiceStatus:name == "voice-status" || name == "edit-voice" ? "Listening…":nil) }
            else if baseline { BaselineChatComposer(text:.constant(ChatRenderFixtures.text(name)),model:.constant(name == "model-label" ? .sonnet55:.opus55),thinking:.constant(.adaptive),effort:.constant(name == "model-label" ? .xhigh:.high),voiceLanguage:.constant(.english),isFocused:$focused,isSending:name == "sending",isRuntimeTurnActive:name.hasPrefix("active") || name == "interrupt",isRuntimeControlInFlight:name == "control",interruptRequested:name == "interrupt",isEditing:name.hasPrefix("edit"),attachments:ChatRenderFixtures.attachments(name),voiceEnabled:name != "voice-disabled",voiceStatus:name == "voice-status" || name == "edit-voice" ? "Listening…":nil) }
            else { ChatComposer(text:.constant(ChatRenderFixtures.text(name)),model:.constant(name == "model-label" ? .sonnet55:.opus55),thinking:.constant(.adaptive),effort:.constant(name == "model-label" ? .xhigh:.high),voiceLanguage:.constant(.english),isFocused:$focused,isSending:name == "sending",isRuntimeTurnActive:name.hasPrefix("active") || name == "interrupt",isRuntimeControlInFlight:name == "control",interruptRequested:name == "interrupt",isEditing:name.hasPrefix("edit"),attachments:ChatRenderFixtures.attachments(name),voiceEnabled:name != "voice-disabled",voiceStatus:name == "voice-status" || name == "edit-voice" ? "Listening…":nil) }
        }.chatFrame("composer").padding(.horizontal,12).onAppear {
            if name == "active-empty" {
                var count=0
                for bits in 0..<128 {
                    let empty=bits & 1 != 0, hasAttachment=bits & 2 != 0, ready=bits & 4 != 0
                    let active=bits & 8 != 0, flight=bits & 16 != 0, requested=bits & 32 != 0, sending=bits & 64 != 0
                    let text=empty ? "  \n " : "hello"
                    let attachments:[NativeLiveComposerAttachmentDraft]=hasAttachment ? [.init(id:ChatRenderFixtures.id,filename:"fixture.txt",mimeType:"text/plain",kind:.file,data:nil,state:ready ? .ready("fixture"):.uploading)]:[]
                    let old=BaselineChatComposer(text:.constant(text),model:.constant(.opus55),thinking:.constant(.adaptive),effort:.constant(.high),voiceLanguage:.constant(.english),isFocused:$focused,isSending:sending,isRuntimeTurnActive:active,isRuntimeControlInFlight:flight,interruptRequested:requested,attachments:attachments)
                    let current=ChatComposer(text:.constant(text),model:.constant(.opus55),thinking:.constant(.adaptive),effort:.constant(.high),voiceLanguage:.constant(.english),isFocused:$focused,isSending:sending,isRuntimeTurnActive:active,isRuntimeControlInFlight:flight,interruptRequested:requested,attachments:attachments)
                    precondition(old.fixtureAction()==current.fixtureAction(),"Action presentation mismatch bits=\(bits)")
                    count+=1
                }
                var selections=0
                for model in NativeLiveClaudeModel.allCases {
                    for thinking in NativeLiveThinkingMode.allCases {
                        for effort in NativeLiveEffortLevel.allCases {
                            for target in NativeLiveClaudeModel.allCases {
                                let old=ComposerSelectionBox(model,thinking,effort), current=ComposerSelectionBox(model,thinking,effort)
                                let lhs=BaselineChatComposer(text:.constant(""),model:old.modelBinding,thinking:old.thinkingBinding,effort:old.effortBinding,voiceLanguage:.constant(.english),isFocused:$focused)
                                let rhs=ChatComposer(text:.constant(""),model:current.modelBinding,thinking:current.thinkingBinding,effort:current.effortBinding,voiceLanguage:.constant(.english),isFocused:$focused)
                                lhs.fixtureSelectModel(target);rhs.fixtureSelectModel(target)
                                precondition(old.snapshot == current.snapshot,"Model correction mismatch")
                                selections+=1
                            }
                            for target in NativeLiveThinkingMode.allCases {
                                let old=ComposerSelectionBox(model,thinking,effort), current=ComposerSelectionBox(model,thinking,effort)
                                let lhs=BaselineChatComposer(text:.constant(""),model:old.modelBinding,thinking:old.thinkingBinding,effort:old.effortBinding,voiceLanguage:.constant(.english),isFocused:$focused)
                                let rhs=ChatComposer(text:.constant(""),model:current.modelBinding,thinking:current.thinkingBinding,effort:current.effortBinding,voiceLanguage:.constant(.english),isFocused:$focused)
                                lhs.fixtureSelectThinking(target);rhs.fixtureSelectThinking(target)
                                precondition(old.snapshot == current.snapshot,"Thinking/effort correction mismatch")
                                selections+=1
                            }
                        }
                    }
                }
                print("Composer selection matrix PASS: \(selections) transitions")
                print("Composer presentation matrix PASS: \(count) combinations")
            }
        }
    }
}
@MainActor struct ChatRenderChecks {
    struct Sample { let frames:[String:CGRect];let pixels:[UInt8];let staticPixels:[UInt8];let width:Int;let height:Int }
    static func run(_ scene:UIWindowScene) async {
        let observer = NotificationCenter.default.addObserver(forName:UIResponder.keyboardDidShowNotification,object:nil,queue:.main) { n in
            ChatRenderFixtures.keyboardFrame = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            ChatRenderFixtures.keyboardPresented = true; ChatRenderFixtures.keyboardDismissed = false
        }
        let dismissObserver = NotificationCenter.default.addObserver(forName:UIResponder.keyboardDidHideNotification,object:nil,queue:.main) { _ in
            ChatRenderFixtures.keyboardPresented = false; ChatRenderFixtures.keyboardDismissed = true
        }
        defer { NotificationCenter.default.removeObserver(observer); NotificationCenter.default.removeObserver(dismissObserver) }
        let tablet=UIDevice.current.userInterfaceIdiom == .pad
        let width=tablet ? 1024:390, height=tablet ? 1100:844
        var cases=0, frameCount=0
        if ProcessInfo.processInfo.environment["COMPOSER_NEGATIVE"] == "1" {
            let base=await sample(AnyView(ComposerRenderHost(name:"attachment-ready",baseline:true)),scene,width,height,false,ChatRenderFixtures.model("empty"))
            let wrong=await sample(AnyView(ComposerRenderHost(name:"attachment-ready",baseline:false,rejected:true)),scene,width,height,false,ChatRenderFixtures.model("empty"))
            compare(base,wrong,"negative attachment height 54→55")
        }
        for staticPass in [false,true] {
          ChatRenderFixtures.staticPass=staticPass
          for dark in [false,true] {
            for name in ["empty","text","multiline","keyboard","edit","edit-voice","attachment-ready","attachment-uploading","attachment-failed","multiple","voice","voice-disabled","voice-status","sending","active-empty","active-text","interrupt","control","model-label"] {
                ChatRenderFixtures.keyboardShown = name == "keyboard"
                let base=await sample(AnyView(ComposerRenderHost(name:name,baseline:true)),scene,width,height,dark,ChatRenderFixtures.model("empty"))
                let current=await sample(AnyView(ComposerRenderHost(name:name,baseline:false)),scene,width,height,dark,ChatRenderFixtures.model("empty"))
                compare(base,current,"Composer/\(name)/\(dark)")
                for key in ["composer","input","plus","model","keyboard-dismiss","primary-action"] { precondition(base.frames[key] != nil,"Missing measured frame \(key)") }
                if name.hasPrefix("edit") {precondition(base.frames["edit"] != nil)}
                for a in ChatRenderFixtures.attachments(name) {precondition(base.frames["attachment-chip.\(a.id)"] != nil)}
                frameCount+=base.frames.count;cases+=1
            }
        }
        }
        // The rejected product chip is 55pt rather than 54pt. Its frame must differ.
        ChatRenderFixtures.keyboardShown=false
        let baseline=await sample(AnyView(ComposerRenderHost(name:"attachment-ready",baseline:true)),scene,width,height,false,ChatRenderFixtures.model("empty"))
        let bad=await sample(AnyView(ComposerRenderHost(name:"attachment-ready",baseline:false,rejected:true)),scene,width,height,false,ChatRenderFixtures.model("empty"))
        precondition(baseline.frames != bad.frames,"Negative control failed to detect incorrect attachment geometry")
        if ProcessInfo.processInfo.environment["COMPOSER_NEGATIVE"] == "1" { compare(baseline,bad,"negative-control") }
        print("Composer render equivalence PASS: \(cases) cases / \(frameCount) exact frames; negative attachment geometry detected; device=\(tablet ? "iPad":"iPhone")");fflush(stdout)
    }
    static func compare(_ lhs:Sample,_ rhs:Sample,_ name:String) {
        precondition(lhs.frames == rhs.frames,"frame mismatch \(name): baseline=\(lhs.frames) current=\(rhs.frames)")
        // Real glass and its shadow are classified separately because the
        // system compositor samples the active window. A second opaque blue
        // backdrop pass protects ALL foreground/fill/border/shape pixels.
        // Keyboard/caret and indeterminate progress alone remain dynamic in
        // that second pass. Neither pass relaxes CGRect equality.
        let dynamic=lhs.frames.filter { ["scroll-action","copy-feedback","load-older","primary-action","system.caret","keyboard"].contains($0.key) || $0.key.hasPrefix("attachment-progress.") }.map{$0.value.insetBy(dx:-12,dy:-12)}
        let composerGlass=lhs.frames["composer"]?.insetBy(dx:-20,dy:-20)
        var staticPixels=0,systemPixels=0
        var mismatch=CGRect.null
        for p in 0..<(lhs.width*lhs.height) {
            let i=p*4
            guard lhs.pixels[i] != rhs.pixels[i] || lhs.pixels[i+1] != rhs.pixels[i+1] || lhs.pixels[i+2] != rhs.pixels[i+2] || lhs.pixels[i+3] != rhs.pixels[i+3] else {continue}
            let point=CGPoint(x:p%lhs.width,y:p/lhs.width)
            if dynamic.contains(where:{$0.contains(point)}) || !ChatRenderFixtures.staticPass && composerGlass?.contains(point) == true {systemPixels+=1} else {staticPixels+=1;mismatch=mismatch.union(CGRect(x:point.x,y:point.y,width:1,height:1))}
        }
        var flatDifference=0
        for p in 0..<(lhs.width*lhs.height) {
            let i=p*4
            if lhs.staticPixels[i] == rhs.staticPixels[i] && lhs.staticPixels[i+1] == rhs.staticPixels[i+1] && lhs.staticPixels[i+2] == rhs.staticPixels[i+2] && lhs.staticPixels[i+3] == rhs.staticPixels[i+3] { continue }
            let point=CGPoint(x:p%lhs.width,y:p/lhs.width)
            // Only system caret/keyboard and indeterminate progress remain
            // dynamic with an opaque backdrop. Static glyphs stay protected.
            let transient=lhs.frames.filter { ["system.caret","keyboard"].contains($0.key) || $0.key.hasPrefix("attachment-progress.") || name.contains("interrupt") && $0.key == "primary-action" || name.contains("load-older") && $0.key == "load-older" }.map{$0.value.insetBy(dx:-2,dy:-2)}
            if ChatRenderFixtures.staticPass && !transient.contains(where:{$0.contains(point)}) { flatDifference+=1 }
        }
        precondition(flatDifference==0,"opaque-backdrop pixel mismatch \(name): \(flatDifference)")
        precondition(staticPixels==0,"static pixel mismatch \(name): \(staticPixels) bounds=\(mismatch) frames=\(lhs.frames)")
        print("opaque=\(ChatRenderFixtures.staticPass) \(name): \(lhs.frames.count) exact frames; static pixels=\(staticPixels); opaque-backdrop pixels=\(flatDifference); system pixels=\(systemPixels)");fflush(stdout)
    }
    static func sample(_ content:AnyView,_ scene:UIWindowScene,_ width:Int,_ height:Int,_ dark:Bool,_ model:AppModel,scroll:Bool=false) async ->Sample {
        let store=ChatFrameStore()
        let root=content.frame(maxWidth:.infinity,maxHeight:.infinity).background(Color(uiColor:.systemBackground).ignoresSafeArea()).environmentObject(model).environment(\.colorScheme,dark ? .dark:.light).onPreferenceChange(ChatFrames.self){store.frames=$0}
        let host=UIHostingController(rootView:root.environment(\.chatStaticBackdrop,ChatRenderFixtures.staticPass)), window=UIWindow(windowScene:scene)
        window.frame=CGRect(x:0,y:0,width:width,height:height);window.overrideUserInterfaceStyle=dark ? .dark:.light
        window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
        await waitForLayout("composer mount", host, store) { store.frames["composer"] != nil }
        if ChatRenderFixtures.keyboardShown {
            guard let input=findInput(host.view) else { preconditionFailure("Real UIKit text input not found") }
            ChatRenderFixtures.keyboardFrame = nil; ChatRenderFixtures.keyboardPresented = false
            input.becomeFirstResponder()
            await waitForLayout("keyboard presentation", host, store) { ChatRenderFixtures.keyboardPresented }
            host.view.layoutIfNeeded()
            precondition(hasFirstResponder(host.view),"Keyboard fixture must focus the real input")
            precondition(ChatRenderFixtures.keyboardFrame != nil,"Keyboard fixture must receive a real keyboard notification")
            store.frames["keyboard"] = window.convert(ChatRenderFixtures.keyboardFrame!, from: scene.screen.coordinateSpace)
            print("Keyboard owner: screen=\(ChatRenderFixtures.keyboardFrame!) hosted=\(store.frames["keyboard"]!) bounds=\(window.bounds)"); fflush(stdout)
            if let textInput=input as? UITextInput, let range=textInput.selectedTextRange {
                store.frames["system.caret"] = input.convert(textInput.caretRect(for:range.start),to:host.view)
            }
        }
        if scroll,let view=findScroll(host.view) { view.setContentOffset(.zero,animated:false);try? await Task.sleep(for:.seconds(0.2)) }
        let pixels=raster(host.view,window.bounds,width,height)
        let frames=store.frames;window.endEditing(true)
        if ChatRenderFixtures.keyboardShown { await waitForLayout("keyboard dismissal", host, store) { ChatRenderFixtures.keyboardDismissed } }
        window.isHidden=true
        return .init(frames:frames,pixels:pixels,staticPixels:pixels,width:width,height:height)
    }
    static func waitForLayout(_ name:String,_ host:UIHostingController<some View>,_ store:ChatFrameStore,_ ready:()->Bool) async {
        let deadline=Date().addingTimeInterval(5)
        var previous:[String:CGRect]?;var stable=0
        while Date() < deadline {
            host.view.layoutIfNeeded(); CATransaction.flush()
            if ready() && previous == store.frames { stable += 1 } else { stable=0 }
            if stable >= 3 { return }
            previous=store.frames
            try? await Task.sleep(for:.milliseconds(16))
        }
        preconditionFailure("Layout owner did not settle: \(name)")
    }
    static func raster(_ view:UIView,_ bounds:CGRect,_ width:Int,_ height:Int)->[UInt8] {
        let format=UIGraphicsImageRendererFormat();format.scale=1
        let image=UIGraphicsImageRenderer(bounds:bounds,format:format).image{_ in view.drawHierarchy(in:bounds,afterScreenUpdates:true)}
        var pixels=[UInt8](repeating:0,count:width*height*4)
        pixels.withUnsafeMutableBytes{bytes in let context=CGContext(data:bytes.baseAddress,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!;context.draw(image.cgImage!,in:bounds)}
        return pixels
    }
    static func findInput(_ view:UIView)->UIView? { if view is UITextField || view is UITextView { return view };return view.subviews.compactMap{findInput($0)}.first }
    static func hasFirstResponder(_ view:UIView)->Bool { view.isFirstResponder || view.subviews.contains(where:hasFirstResponder) }
    static func findScroll(_ view:UIView)->UIScrollView? { if let scroll=view as? UIScrollView{return scroll};return view.subviews.compactMap{findScroll($0)}.first }
}
final class ChatChecksAppDelegate:NSObject,UIApplicationDelegate {
    func application(_ application:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration {let c=UISceneConfiguration(name:"Tests",sessionRole:session.role);c.delegateClass=ChatChecksSceneDelegate.self;return c}
}
final class ChatChecksSceneDelegate:NSObject,UIWindowSceneDelegate {
    var window:UIWindow?
    func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions){guard let scene=scene as? UIWindowScene else{return};window=UIWindow(windowScene:scene);window?.rootViewController=UIViewController();window?.makeKeyAndVisible();DispatchQueue.main.asyncAfter(deadline:.now()+0.5){Task { await ChatRenderChecks.run(scene);exit(0) }}}
}
@main struct ChatChecksApp {static func main(){UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(ChatChecksAppDelegate.self))}}
