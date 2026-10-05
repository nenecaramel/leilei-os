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
    static func text(_ name:String)->String {
        switch name { case "text","active-text","edit","keyboard": return "Hello Leilei"
        case "multiline": return "First line\nSecond line\nThird line\nFourth line"
        default:return "" }
    }
    static func attachments(_ name:String)->[NativeLiveComposerAttachmentDraft] {
        guard name == "attachment" else {return []}
        return [.init(id:id,filename:"fixture.txt",mimeType:"text/plain",kind:.file,data:Data("abc".utf8),state:.ready("fixture"))]
    }
    static func message(_ role:String,_ text:String, tool:Bool=false)->NativeLiveCurrentPathMessage {
        var blocks = [NativeLiveCurrentPathBlock(id:role+"-text",ordinal:0,kind:"text",rawType:"text",text:text,payload:nil,createdAt:"2026-10-05T00:00:00Z")]
        if tool {
            blocks.append(.init(id:"tool",ordinal:1,kind:"tool_use",rawType:"tool_use",text:nil,payload:["tool_use_id":.string("tool"),"tool_name":.string("Read"),"input":.object(["file_path":.string("fixture.txt")])],createdAt:"2026-10-05T00:00:00Z"))
            blocks.append(.init(id:"result",ordinal:2,kind:"tool_result",rawType:"tool_result",text:nil,payload:["tool_use_id":.string("tool"),"output":.string("Fixture read complete")],createdAt:"2026-10-05T00:00:00Z"))
        }
        return .init(id:role,conversationId:id.uuidString,parentMessageId:role == "assistant" ? "user":nil,role:role,status:"completed",createdAt:"2026-10-05T00:00:00Z",completedAt:nil,blocks:blocks)
    }
    static func snapshot(_ name:String)->NativeLiveCurrentPathSnapshot {
        .init(conversationId:id.uuidString,title:"Fixture",currentHeadMessageId:"assistant",updatedAt:"2026-10-05T00:00:00Z",syncToken:"fixture",truncated:false,olderCursor:name == "load-older" || name == "history" || name == "older-available" ? "older":nil,resetRequired:false,messages:[])
    }
    static func model(_ name:String)->AppModel {
        let model = AppModel() // Only in the disposable, unauthenticated test bundle.
        let user = message("user",name == "long-user" ? Array(repeating:"A long user message.",count:45).joined(separator:"\n") : "A user message")
        let assistant = message("assistant",name == "long" || name == "return-bottom" ? Array(repeating:"A long assistant paragraph for wrapping and scrolling.",count:32).joined(separator:"\n\n") : "An assistant reply.",tool:name == "activity")
        let turn = NativeLiveAssistantTurnPresentation(stableID:"assistant",canonicalMessageID:nil,prepareID:nil,requestID:nil,parentUserMessageID:"user",phase:.completed,timestamp:"2026-10-05T00:00:00Z",bodyPresentation:NativeLiveMessagePresentationProjector.project(.canonical(assistant)),activityProjection:.init(message:assistant),duration:nil,header:name == "activity" ? "Worked": "",failure:nil)
        model.nativeLiveConversationRows = name == "empty" ? [] : [
            .init(id:"user",user:NativeLiveMessagePresentationProjector.project(.canonical(user)),userBacking:user,assistant:nil),
            .init(id:"assistant",user:nil,userBacking:nil,assistant:turn)]
        if name == "history" { var row = NativeLiveConversationRowPresentation(id:"history",user:nil,userBacking:nil,assistant:nil); row.isHistoryDivider=true;model.nativeLiveConversationRows.insert(row,at:0) }
        if name == "single-user" { model.nativeLiveConversationRows.removeLast() }
        if name == "many" || name == "mixed-history" {
            for index in 0..<12 {
                var next = model.nativeLiveConversationRows[index % 2]
                next = .init(id:"extra-\(index)",user:next.user,userBacking:next.userBacking,assistant:next.assistant)
                model.nativeLiveConversationRows.append(next)
            }
            if name == "mixed-history" { var divider=NativeLiveConversationRowPresentation(id:"history",user:nil,userBacking:nil,assistant:nil);divider.isHistoryDivider=true;model.nativeLiveConversationRows.insert(divider,at:5) }
        }
        if name == "activity" { model.nativeLiveMessageUIState["assistant"].activityExpansion = .userExpanded }
        return model
    }
}
@MainActor @Observable final class SurfaceRuntimeInputs {
    var snapshot:NativeLiveCurrentPathSnapshot
    init(token:String="inactive") {
        snapshot = .init(conversationId:ChatRenderFixtures.id.uuidString,title:"Runtime",currentHeadMessageId:"assistant",updatedAt:"2026-10-05T00:00:00Z",syncToken:token,truncated:false,olderCursor:nil,resetRequired:false,messages:[])
    }
    var pending:NativeLivePendingOperation?
}
@MainActor enum SurfaceRuntimeProbe {
    static var inputs=SurfaceRuntimeInputs()
    static var fixedRowHeight:CGFloat?
    static var generation=0
    static var activeToken="inactive"
    static func isActive(_ token:String?)->Bool {token==activeToken && activeToken.hasPrefix("surface-runtime-")}
    static var model=ChatRenderFixtures.model("many")
    static var actions:[String:()->Void]=[:]
    static var phase:((ScrollPhase,ScrollPhase)->Void)?
    static var commands:[String]=[]
    static var rowFrames:[String:CGRect]=[:]
    static var move:((Double)->Void)?
    static var pending:((NativeLivePendingOperation?)->Void)?
    static var geometry:((Double,Bool,Double,Double)->Void)?
    static var state:(()->[Bool])?
    static var reset:(()->Void)?
    static var replaying=false
    static var pendingSequence=0
    static func nextPendingID()->UUID {pendingSequence+=1;return UUID(uuidString:String(format:"00000000-0000-0000-0000-%012d",pendingSequence))!}
    static func capture(_ name:String,active:Bool,_ action:@escaping ()->Void)->()->Void { if active {actions[name]=action};return action }
    static func extra(_ id:String)->NativeLiveConversationRowPresentation {
        // Runtime rows must have unique canonical identities as real messages do.
        let message=NativeLiveCurrentPathMessage(id:id,conversationId:ChatRenderFixtures.id.uuidString,parentMessageId:nil,role:"user",status:"completed",createdAt:"2026-10-05T00:00:00Z",completedAt:nil,blocks:[.init(id:id+"-text",ordinal:0,kind:"text",rawType:"text",text:"Additional fixture message",payload:nil,createdAt:"2026-10-05T00:00:00Z")])
        return .init(id:id,user:NativeLiveMessagePresentationProjector.project(.canonical(message)),userBacking:message,assistant:nil)
    }
}
extension View {
    func surfaceTestScrollPhaseChange(active:Bool,_ action:@escaping (ScrollPhase,ScrollPhase)->Void)->some View {
        if active {SurfaceRuntimeProbe.phase=action}
        return onScrollPhaseChange { old,new in if !SurfaceRuntimeProbe.replaying {action(old,new)} }
    }
}
@MainActor struct SurfaceRuntimeHost:View {
    let baseline:Bool
    let inputs:SurfaceRuntimeInputs
    let model:AppModel
    var body:some View {
        if baseline {BaselineNativeLiveMessageSurface.runtimeFixture(inputs,model:model)}
        else {NativeLiveMessageSurface.runtimeFixture(inputs,model:model)}
    }
}
@MainActor enum SurfaceRuntimeChecks {
    struct Step:Equatable {let name:String;let offset:Double;let frames:[String:CGRect];let commands:[String]}
    static func replay() async->[String] {
        SurfaceRuntimeProbe.replaying=true;SurfaceRuntimeProbe.reset?();SurfaceRuntimeProbe.commands=[]
        var trace=[String]()
        func record(_ event:String) {trace.append("\(event):\(SurfaceRuntimeProbe.state?() ?? []):\(SurfaceRuntimeProbe.commands)");SurfaceRuntimeProbe.commands=[]}
        SurfaceRuntimeProbe.geometry?(0,true,0,100);try? await Task.sleep(for:.milliseconds(100));record("initial geometry/yield")
        SurfaceRuntimeProbe.phase?(.idle,.interacting);record("begin interaction")
        SurfaceRuntimeProbe.geometry?(100,false,20,100);record("away geometry")
        SurfaceRuntimeProbe.phase?(.interacting,.idle);record("end interaction")
        SurfaceRuntimeProbe.geometry?(100,false,20,200);try? await Task.sleep(for:.milliseconds(100));record("away content/yield")
        SurfaceRuntimeProbe.actions["return"]?();try? await Task.sleep(for:.milliseconds(500));record("return action")
        SurfaceRuntimeProbe.geometry?(200,true,100,250);try? await Task.sleep(for:.milliseconds(100));record("near content/yield")
        SurfaceRuntimeProbe.phase?(.idle,.interacting);record("near begin")
        SurfaceRuntimeProbe.geometry?(250,true,100,300);try? await Task.sleep(for:.milliseconds(100));record("interacting content/yield")
        SurfaceRuntimeProbe.phase?(.interacting,.idle);record("near end")
        SurfaceRuntimeProbe.geometry?(300,true,100,400);try? await Task.sleep(for:.milliseconds(100));record("follow content/yield")
        for kind:NativeLivePendingOperation.Kind in [.send(text:"fixture"),.retry(targetUserMessageID:"user"),.edit(targetUserMessageID:"user",text:"edited")] {
            SurfaceRuntimeProbe.pending?(.surfaceFixture(kind));record("pending \(kind) scheduled")
            try? await Task.sleep(for:.milliseconds(100));record("pending \(kind) yield")
        }
        SurfaceRuntimeProbe.replaying=false;return trace
    }
    static func sample(_ scene:UIWindowScene,_ baseline:Bool,_ width:Int,_ height:Int) async->([Step],[String]) {
        SurfaceRuntimeProbe.fixedRowHeight=80;SurfaceRuntimeProbe.replaying=true;SurfaceRuntimeProbe.pendingSequence=0;SurfaceRuntimeProbe.generation+=1;SurfaceRuntimeProbe.activeToken="surface-runtime-\(SurfaceRuntimeProbe.generation)";SurfaceRuntimeProbe.inputs=SurfaceRuntimeInputs(token:SurfaceRuntimeProbe.activeToken);SurfaceRuntimeProbe.inputs.pending = .surfaceFixture(.send(text:"seed"));SurfaceRuntimeProbe.model=ChatRenderFixtures.model("single-user")
        // Only runtime integration fixes outer real-row fixture height to 80pt.
        // Static render cases keep nil height and the original intrinsic geometry.
        // Mixed/long rows are separately covered by the strict static render matrix.
        // Ensure real scrolling on both device sizes, with stable identities.
        for i in 0..<60 {SurfaceRuntimeProbe.model.nativeLiveConversationRows.append(SurfaceRuntimeProbe.extra("runtime-\(i)"))}
        SurfaceRuntimeProbe.actions=[:];SurfaceRuntimeProbe.commands=[]
        let frames=ChatFrameStore()
        // Isolate ScrollPosition's viewport coordinates from UIWindow's automatic
        // status-bar inset. Full Chat/render tests separately retain real safe areas.
        // Compare settled geometry without simulator presentation-layer interpolation.
        // Product animation declarations are independently conserved byte-for-byte.
        let root=SurfaceRuntimeHost(baseline:baseline,inputs:SurfaceRuntimeProbe.inputs,model:SurfaceRuntimeProbe.model).transaction { $0.animation=nil;$0.disablesAnimations=true }.ignoresSafeArea().environmentObject(SurfaceRuntimeProbe.model).onPreferenceChange(ChatFrames.self){frames.frames=$0}
        let host=UIHostingController(rootView:root),window=UIWindow(windowScene:scene)
        window.frame=CGRect(x:0,y:0,width:width,height:height);window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
        host.view.layoutIfNeeded();try? await Task.sleep(for:.seconds(1))
        guard var scroll=ChatRenderChecks.findScroll(host.view) else {preconditionFailure("Actual SwiftUI UIScrollView missing")}
        precondition(scroll.contentSize.height > scroll.bounds.height)
        var result=[Step]()
        var controlledHeight=6400.0
        func geometry(_ near:Bool,_ growth:Double=0) {
            let previous=controlledHeight;controlledHeight+=growth
            SurfaceRuntimeProbe.geometry?(previous,near,scroll.contentOffset.y,controlledHeight)
        }
        geometry(true,1);try? await Task.sleep(for:.milliseconds(300))
        func record(_ name:String) {
            print("runtime baseline=\(baseline) step=\(name) offset=\(scroll.contentOffset.y) commands=\(SurfaceRuntimeProbe.commands.count)");fflush(stdout)
            var measured=Dictionary(uniqueKeysWithValues:SurfaceRuntimeProbe.rowFrames.map {("row."+$0.key,$0.value)})
            // The production preference is the scroll/anchor source of truth.
            // The independently instrumented global frames remain strict in static cases.
            measured["bottom-anchor"]=frames.frames["bottom-anchor"]
            measured["scroll-action"]=frames.frames["scroll-action"]
            let following=["initial-bottom","return-bottom","near-content"].contains(name) || name.hasPrefix("pending-send")
            let visible=measured.filter { entry in
                if entry.key == "bottom-anchor",following {return true}
                if entry.key == "scroll-action" {return SurfaceRuntimeProbe.state?().last==true}
                return (entry.key.hasPrefix("row.") || entry.key == "bottom-anchor") && entry.value.maxY>0 && entry.value.minY<Double(height)
            }
            // Natural geometry is suppressed; identical metrics are delivered to
            // the original observer, so ordered command counts also compare exactly.
            let commands=SurfaceRuntimeProbe.commands
            result.append(.init(name:name,offset:scroll.contentOffset.y,frames:visible,commands:commands));SurfaceRuntimeProbe.commands=[]
        }
        record("initial-bottom")
        precondition(scroll.contentOffset.y > 0,"Must start at actual bottom")
        // Deliver the same actual scroll-phase callback used by the view,
        // alongside real UIScrollView offsets. This is deterministic input,
        // not a synthesized touchscreen gesture or a second scroll algorithm.
        SurfaceRuntimeProbe.phase?(.idle,.interacting)
        SurfaceRuntimeProbe.move?(80);try? await Task.sleep(for:.milliseconds(200))
        geometry(false);SurfaceRuntimeProbe.phase?(.interacting,.idle);try? await Task.sleep(for:.milliseconds(200));record("manual-away")
        let away=scroll.contentOffset.y
        SurfaceRuntimeProbe.model.nativeLiveConversationRows.append(SurfaceRuntimeProbe.extra("away-new"));geometry(false,101);try? await Task.sleep(for:.milliseconds(400));record("away-content")
        precondition(scroll.contentOffset.y==away,"New content must not steal away position")
        // Invoke actual owner action captured from the real Button initializer.
        precondition(SurfaceRuntimeProbe.actions["return"] != nil);SurfaceRuntimeProbe.actions["return"]?()
        try? await Task.sleep(for:.seconds(2));geometry(true);record("return-bottom")
        precondition(scroll.contentOffset.y > away)
        SurfaceRuntimeProbe.model.nativeLiveConversationRows.append(SurfaceRuntimeProbe.extra("near-new"));geometry(true,101);try? await Task.sleep(for:.milliseconds(500));geometry(true);record("near-content")
        for kind:NativeLivePendingOperation.Kind in [.send(text:"fixture"),.retry(targetUserMessageID:"user"),.edit(targetUserMessageID:"user",text:"edited")] {
            SurfaceRuntimeProbe.phase?(.idle,.interacting);SurfaceRuntimeProbe.move?(100);try? await Task.sleep(for:.milliseconds(200));geometry(false);SurfaceRuntimeProbe.phase?(.interacting,.idle)
            let before=SurfaceRuntimeProbe.rowFrames.filter{$0.value.maxY>0}.min{$0.value.minY < $1.value.minY}
            let operation=NativeLivePendingOperation.surfaceFixture(kind)
            SurfaceRuntimeProbe.inputs.pending = operation
            SurfaceRuntimeProbe.pending?(operation)
            if !operation.isSend,let before,let index=SurfaceRuntimeProbe.model.nativeLiveConversationRows.firstIndex(where:{$0.id==before.key}) {
                let replacement=SurfaceRuntimeProbe.model.nativeLivePresentationAssembler.pendingIDs(operation,snapshot:SurfaceRuntimeProbe.inputs.snapshot,identities:SurfaceRuntimeProbe.model.nativeLiveTurnIdentities).assistant
                let row=SurfaceRuntimeProbe.model.nativeLiveConversationRows[index]
                // Preserve body height while exercising actual identity fallback;
                // a partially visible anchor must not shrink fully out of the lazy viewport.
                SurfaceRuntimeProbe.model.nativeLiveConversationRows[index] = .init(id:replacement,user:row.user,userBacking:row.userBacking,assistant:row.assistant)
            }
            try? await Task.sleep(for:.seconds(2));host.view.layoutIfNeeded();geometry(operation.isSend);record("pending-\(String(describing:kind))")
            if operation.isSend {precondition(scroll.contentOffset.y > 100,"Changed pending send must follow actual bottom")}
            else if let before {
                let replacement=SurfaceRuntimeProbe.model.nativeLivePresentationAssembler.pendingIDs(operation,snapshot:SurfaceRuntimeProbe.inputs.snapshot,identities:SurfaceRuntimeProbe.model.nativeLiveTurnIdentities).assistant
                precondition(SurfaceRuntimeProbe.rowFrames[before.key]==nil,"Must really remove original anchor row")
                precondition(SurfaceRuntimeProbe.rowFrames[replacement]?.minY==before.value.minY,"Replacement must restore original relative offset: before=\(before), after=\(SurfaceRuntimeProbe.rowFrames[replacement] as Any), offset=\(scroll.contentOffset), commands=\(SurfaceRuntimeProbe.commands)")
                record("replacement-\(String(describing:kind))")
            }
        }
        SurfaceRuntimeProbe.inputs.pending=nil
        let previous=SurfaceRuntimeProbe.inputs.snapshot
        SurfaceRuntimeProbe.inputs.snapshot = .init(conversationId:previous.conversationId,title:previous.title,currentHeadMessageId:previous.currentHeadMessageId,updatedAt:previous.updatedAt,syncToken:previous.syncToken,truncated:false,olderCursor:"older",resetRequired:false,messages:[])
        try? await Task.sleep(for:.milliseconds(500))
        guard let idleScroll=ChatRenderChecks.findScroll(host.view) else {preconditionFailure("Idle scroll missing")};scroll=idleScroll
        SurfaceRuntimeProbe.phase?(.idle,.interacting);SurfaceRuntimeProbe.move?(0);try? await Task.sleep(for:.milliseconds(200));geometry(false);SurfaceRuntimeProbe.phase?(.interacting,.idle)
        let before=SurfaceRuntimeProbe.rowFrames.filter{$0.value.maxY>0}.min{$0.value.minY < $1.value.minY}
        SurfaceRuntimeProbe.actions["older"]?();try? await Task.sleep(for:.seconds(1));record("load-older")
        // Only this before/after arithmetic allows four machine ulps (not pixels).
        // Baseline/current full CGRect dictionaries below still compare exactly.
        if let before {precondition(SurfaceRuntimeProbe.rowFrames[before.key].map { abs($0.minY-before.value.minY) <= 4 * Double.ulpOfOne * max(1,abs(before.value.minY)) } == true,"Pagination visible anchor moved: before=\(before), after=\(SurfaceRuntimeProbe.rowFrames[before.key] as Any), offset=\(scroll.contentOffset)")}
        let replayTrace=await replay();window.isHidden=true;try? await Task.sleep(for:.milliseconds(300));return (result,replayTrace)
    }
    static func run(_ scene:UIWindowScene,_ width:Int,_ height:Int) async {
        let old=await sample(scene,true,width,height),current=await sample(scene,ProcessInfo.processInfo.environment["SURFACE_BASELINE_SELF"] == "1",width,height)
        var matched=old.0.count==current.0.count && old.0.map(\.name)==current.0.map(\.name)
        for (lhs,rhs) in zip(old.0,current.0) {
            // Independent main-vs-main lazy layouts vary in subpixel estimates.
            // Dynamic integration requires zero physical-pixel rectangle delta;
            // the intrinsic static matrix still compares raw CGRects bit-exactly.
            let following=["initial-bottom","return-bottom","near-content"].contains(lhs.name) || lhs.name.hasPrefix("pending-send")
            if following {precondition(lhs.frames["bottom-anchor"] != nil && rhs.frames["bottom-anchor"] != nil,"Follow endpoint requires actual bottom anchor")}
            let keys=Set(lhs.frames.keys)
            var sameFrames=keys==Set(rhs.frames.keys)
            for key in keys {
                guard let a=lhs.frames[key],let b=rhs.frames[key] else {sameFrames=false;continue}
                let pairs=[(a.minX,b.minX),(a.minY,b.minY),(a.width,b.width),(a.height,b.height)]
                for (x,y) in pairs {
                    // Main-self pending-send measured 0.15477pt estimator variance.
                    // Follow-only bound is 0.2pt AND zero physical-pixel delta;
                    // all away/replacement/pagination frames retain 1e-9pt arithmetic bound.
                    if abs(x-y) > (following ? 0.2:1e-9) || (x*scene.screen.scale).rounded() != (y*scene.screen.scale).rounded() {sameFrames=false}
                }
            }
            // Follow endpoints use actual visible anchor bounds rather than the
            // LazyVStack estimated offscreen content offset. Away/restore offsets
            // still compare exactly, alongside every physical row rectangle.
            if (!following && lhs.offset != rhs.offset) || lhs.commands != rhs.commands || !sameFrames {
                matched=false;print("Frame diagnostic: baseline=\(lhs.frames) current=\(rhs.frames)");print("Runtime mismatch \(lhs.name): offsets \(lhs.offset)/\(rhs.offset); commands \(lhs.commands)/\(rhs.commands); same physical frames=\(sameFrames)")
            }
        }
        if old.1 != current.1 {matched=false;print("Replay mismatch baseline=\(old.1) current=\(current.1)")}
        SurfaceRuntimeProbe.fixedRowHeight=nil
        guard matched else {fflush(stdout);exit(2)}
        print("MessageSurface runtime equivalence PASS: \(old.0.count) physical steps / \(old.1.count) identical-input observer replay steps; exact away/restore offsets and commands; follow frames <=0.2pt and zero physical-pixel delta; geometry/phase/pending inputs controlled, touch physics not simulated");fflush(stdout)
    }
}

@MainActor struct ChatRenderChecks {
    struct Sample { let frames:[String:CGRect];let pixels:[UInt8];let staticPixels:[UInt8];let width:Int;let height:Int }
    static func run(_ scene:UIWindowScene) async {
        let observer = NotificationCenter.default.addObserver(forName:UIResponder.keyboardWillShowNotification,object:nil,queue:.main) { n in ChatRenderFixtures.keyboardFrame = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect }; defer { NotificationCenter.default.removeObserver(observer) }
        let tablet=UIDevice.current.userInterfaceIdiom == .pad
        let width=tablet ? 1024:390, height=tablet ? 1100:844
        if ProcessInfo.processInfo.environment["SURFACE_RUNTIME_ONLY"] == "1" { await SurfaceRuntimeChecks.run(scene,width,height);print("MessageSurface render equivalence PASS: runtime-only diagnostic");fflush(stdout);return }
        if ProcessInfo.processInfo.environment["SURFACE_NEGATIVE"] == "1" {
            let baseline=await sample(AnyView(BaselineNativeLiveMessageSurface.fixture("return-bottom")),scene,width,height,false,ChatRenderFixtures.model("return-bottom"),scroll:true)
            let rejected=await sample(AnyView(RejectedNativeLiveMessageSurface.fixture("return-bottom")),scene,width,height,false,ChatRenderFixtures.model("return-bottom"),scroll:true)
            precondition(baseline.frames["scroll-action"] != nil && rejected.frames["scroll-action"] != nil,"Negative control requires visible return-button frames")
            precondition(baseline.frames["scroll-action"] == rejected.frames["scroll-action"],"negative paint offset: return-button frame differs: \(baseline.frames["scroll-action"]!) / \(rejected.frames["scroll-action"]!)")
            preconditionFailure("Wrong paint offset unexpectedly passed")
        }
        var cases=0, frameCount=0
        for staticPass in [false,true] {
          ChatRenderFixtures.staticPass=staticPass
          for dark in [false,true] {
            for name in ["empty","single-user","messages","long","many","history","older-available","load-older","return-bottom","return-hidden","copy","activity","long-user","mixed-history"] {
                let base=await sample(AnyView(BaselineNativeLiveMessageSurface.fixture(name)),scene,width,height,dark,ChatRenderFixtures.model(name),scroll:name == "return-bottom")
                let current=await sample(AnyView(NativeLiveMessageSurface.fixture(name)),scene,width,height,dark,ChatRenderFixtures.model(name),scroll:name == "return-bottom")
                compare(base,current,"Messages/\(name)/\(dark)")
                if name != "empty" { precondition(base.frames["surface"] != nil && base.frames.keys.contains(where:{$0.hasPrefix("row.")})) }
                if name == "return-bottom" { precondition(base.frames["scroll-action"] != nil) }
                if name == "copy" { precondition(base.frames["copy-feedback"] != nil) }
                frameCount+=base.frames.count;cases+=1
            }
        }
        }
        await SurfaceRuntimeChecks.run(scene,width,height)
        let baseline=await sample(AnyView(BaselineNativeLiveMessageSurface.fixture("return-bottom")),scene,width,height,false,ChatRenderFixtures.model("return-bottom"),scroll:true)
        let bad=await sample(AnyView(RejectedNativeLiveMessageSurface.fixture("return-bottom")),scene,width,height,false,ChatRenderFixtures.model("return-bottom"),scroll:true)
        precondition(baseline.frames["scroll-action"] != bad.frames["scroll-action"],"Negative control failed to detect incorrect offset")
        if ProcessInfo.processInfo.environment["SURFACE_NEGATIVE"] == "1" { compare(baseline,bad,"negative-control") }
        print("MessageSurface render equivalence PASS: \(cases) cases / \(frameCount) exact frames; negative offset detected; device=\(tablet ? "iPad":"iPhone")");fflush(stdout)
    }
    static func compare(_ lhs:Sample,_ rhs:Sample,_ name:String) {
        precondition(lhs.frames == rhs.frames,"frame mismatch \(name): baseline=\(lhs.frames) current=\(rhs.frames)")
        // Real glass and its shadow are classified separately because the
        // system compositor samples the active window. A second opaque blue
        // backdrop pass protects ALL foreground/fill/border/shape pixels.
        // Keyboard/caret and indeterminate progress alone remain dynamic in
        // that second pass. Neither pass relaxes CGRect equality.
        let dynamic=lhs.frames.filter { ["scroll-action","copy-feedback","load-older","primary-action","system.caret","keyboard"].contains($0.key) }.map{$0.value.insetBy(dx:-12,dy:-12)}
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
            let transient=lhs.frames.filter { ["system.caret","keyboard"].contains($0.key) || name.contains("interrupt") && $0.key == "primary-action" || name.contains("load-older") && $0.key == "older-progress" }.map{$0.value.insetBy(dx:-2,dy:-2)}
            if ChatRenderFixtures.staticPass && !transient.contains(where:{$0.contains(point)}) { flatDifference+=1 }
        }
        precondition(flatDifference==0,"opaque-backdrop pixel mismatch \(name): \(flatDifference)")
        precondition(staticPixels==0,"static pixel mismatch \(name): \(staticPixels) bounds=\(mismatch) frames=\(lhs.frames)")
        print("opaque=\(ChatRenderFixtures.staticPass) \(name): \(lhs.frames.count) exact frames; static pixels=\(staticPixels); opaque-backdrop pixels=\(flatDifference); system pixels=\(systemPixels)");fflush(stdout)
    }
    static func sample(_ content:AnyView,_ scene:UIWindowScene,_ width:Int,_ height:Int,_ dark:Bool,_ model:AppModel,scroll:Bool=false) async ->Sample {
        let store=ChatFrameStore()
        let root=content.environmentObject(model).environment(\.colorScheme,dark ? .dark:.light).onPreferenceChange(ChatFrames.self){store.frames=$0}
        let host=UIHostingController(rootView:root.environment(\.chatStaticBackdrop,ChatRenderFixtures.staticPass)), window=UIWindow(windowScene:scene)
        window.frame=CGRect(x:0,y:0,width:width,height:height);window.overrideUserInterfaceStyle=dark ? .dark:.light
        window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
        host.view.layoutIfNeeded();try? await Task.sleep(for:.seconds(0.5))
        if ChatRenderFixtures.keyboardShown {
            guard let input=findInput(host.view) else { preconditionFailure("Real UIKit text input not found") }
            input.becomeFirstResponder()
            // Wait for UIKit and SwiftUI keyboard avoidance presentation layers to settle.
            try? await Task.sleep(for:.seconds(2))
            host.view.layoutIfNeeded()
            precondition(hasFirstResponder(host.view),"Keyboard fixture must focus the real input")
            precondition(ChatRenderFixtures.keyboardFrame != nil,"Keyboard fixture must receive a real keyboard notification")
            store.frames["keyboard"] = ChatRenderFixtures.keyboardFrame
            if let textInput=input as? UITextInput, let range=textInput.selectedTextRange {
                store.frames["system.caret"] = input.convert(textInput.caretRect(for:range.start),to:host.view)
            }
        }
        if scroll,let view=findScroll(host.view) { view.setContentOffset(.zero,animated:false);try? await Task.sleep(for:.seconds(0.2)) }
        let pixels=raster(host.view,window.bounds,width,height)
        let frames=store.frames;window.endEditing(true);window.isHidden=true;try? await Task.sleep(for:.seconds(0.6))
        return .init(frames:frames,pixels:pixels,staticPixels:pixels,width:width,height:height)
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
