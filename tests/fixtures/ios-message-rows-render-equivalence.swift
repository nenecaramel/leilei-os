import SwiftUI
import UIKit

private struct RowsPrefix: EnvironmentKey { static let defaultValue = "" }
extension EnvironmentValues {var rowsPrefix:String {get {self[RowsPrefix.self]} set {self[RowsPrefix.self]=newValue}}}
private struct RowsMeasure:ViewModifier {
 @Environment(\.rowsPrefix) var prefix;let name:String
 func body(content:Content)->some View {content.background(GeometryReader {g in Color.clear.preference(key:RowsFrames.self,value:[prefix+name:g.frame(in:.global)])})}
}
struct RowsFrames: PreferenceKey {
 static var defaultValue: [String:CGRect] { [:] }
 static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]) { value.merge(nextValue()) { _,new in new } }
}
extension View {
 func rowsFrame(_ name:String)->some View { modifier(RowsMeasure(name:name)) }
 func rowsTap(_ action:@escaping ()->Void)->some View { onTapGesture(perform:action).onAppear { RowsProbe.tap=action } }
 func rowsEnabled(_ key:String)->some View { modifier(RowsEnabled(key:key)) }
}
private struct RowsEnabled:ViewModifier {
 @Environment(\.isEnabled) var enabled
 let key:String
 func body(content:Content)->some View { content.onAppear { RowsProbe.enabled[key]=enabled } }
}
@MainActor enum RowsProbe {
 static var actions:[String:()->Void]=[:],enabled:[String:Bool]=[:],trace:[String]=[]
 static var tap:(()->Void)?,contextTap:(()->Void)?,edit:(()->Void)?,copy:((String)->Void)?
 static var contextDisabled=false,contextText:String?
 static var coordinator:LightweightContextMenuInteraction.Coordinator?
 static var resolve:((NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws->Void)?
 static func reset(){actions=[:];enabled=[:];trace=[];tap=nil;contextTap=nil;edit=nil;copy=nil;resolve=nil;contextDisabled=false;contextText=nil;coordinator=nil}
 static func capture(_ key:String,_ action:@escaping ()->Void)->()->Void { actions[key]=action;return action }
 static func invoke(_ key:String){if enabled[key] == true {actions[key]?()}}
 static func forward(_ action:@escaping (NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws->Void)->(NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws->Void {resolve=action;return action}
 static func context(title:String,copyText:String?,isDisabled:Bool,cornerRadius:CGFloat,onCopy:@escaping(String)->Void,onTap:(()->Void)?,action:@escaping()->Void)->LightweightContextMenuInteraction {
  contextTap=onTap;edit=action;copy=onCopy;contextDisabled=isDisabled;contextText=copyText
  let interaction=LightweightContextMenuInteraction(title:title,copyText:copyText,isDisabled:isDisabled,cornerRadius:cornerRadius,onCopy:onCopy,onTap:onTap,action:action)
  coordinator=interaction.makeCoordinator();return interaction
 }
}
@MainActor final class RowsFrameStore {var frames:[String:CGRect]=[:]}
@MainActor enum RowsFixtures {
 static let conversation="00000000-0000-0000-0000-000000000123"
 static let cases=["user-short","user-multiline","user-long","voice-collapsed","voice-expanded","voice-editable","voice-editable-disabled","user-editable","user-noneditable","assistant-plain","assistant-timestamp","assistant-activity","assistant-copied","retry-enabled","retry-disabled","mind","album","assistant-long","history-user","history-assistant","divider","history-pagination","user-assistant","assistant-user","multiple","current-head","noncurrent-head"]
 static func message(_ role:String,_ text:String,voice:Bool=false)->NativeLiveCurrentPathMessage {
  .init(id:role,conversationId:conversation,parentMessageId:role=="assistant" ? "user":nil,role:role,status:"completed",createdAt:"2026-10-05T00:00:00Z",completedAt:nil,blocks:[.init(id:role+"-text",ordinal:0,kind:"text",rawType:"text",text:text,payload:voice ? ["input_mode":.string("voice")]:nil,createdAt:"2026-10-05T00:00:00Z")])
 }
 static func row(_ name:String)->NativeLiveConversationRowPresentation {
  if name=="divider" { var row=NativeLiveConversationRowPresentation(id:"divider",user:nil,userBacking:nil,assistant:nil);row.isHistoryDivider=true;return row }
  if name.hasPrefix("history") {var row=NativeLiveConversationRowPresentation(id:"history",user:nil,userBacking:nil,assistant:nil);row.historyMessage = .init(ordinal:1,role:name=="history-user" ? "user":"assistant",time:"2026-10-05T00:00:00Z",content:"Historical message\nA second line");row.historyTimeZone="UTC";return row}
  let isUser=name.hasPrefix("user")||name.hasPrefix("voice")
  let text=name.contains("long") ? Array(repeating:"This is a long message with wrapping and stable punctuation.",count:12).joined(separator:"\n\n") : name.contains("multiline") ? "First line\nSecond line\nThird line":"A fixture message."
  var message=message(isUser ? "user":"assistant",text,voice:name.hasPrefix("voice"))
  if name=="assistant-activity" {message = .init(id:message.id,conversationId:message.conversationId,parentMessageId:message.parentMessageId,role:message.role,status:message.status,createdAt:message.createdAt,completedAt:nil,blocks:message.blocks+[.init(id:"tool",ordinal:1,kind:"tool_use",rawType:"tool_use",text:nil,payload:["tool_use_id":.string("tool"),"tool_name":.string("Read"),"input":.object(["file_path":.string("fixture.txt")])],createdAt:message.createdAt),.init(id:"result",ordinal:2,kind:"tool_result",rawType:"tool_result",text:nil,payload:["tool_use_id":.string("tool"),"output":.string("Read complete")],createdAt:message.createdAt)])}
  let presentation=NativeLiveMessagePresentationProjector.project(.canonical(message))
  if isUser {return .init(id:"user",user:presentation,userBacking:name=="user-noneditable"||(name.hasPrefix("voice") && !name.contains("editable")) ? nil:message,assistant:nil)}
  let turn=NativeLiveAssistantTurnPresentation(stableID:"assistant",canonicalMessageID:name=="mind" ? "assistant":nil,prepareID:nil,requestID:nil,parentUserMessageID:"user",phase:.completed,timestamp:name=="assistant-plain" ? nil:"2026-10-05T00:00:00Z",bodyPresentation:presentation,activityProjection:.init(message:message),duration:nil,header:name=="assistant-activity" ? "Worked":"",failure:nil)
  return .init(id:"assistant",user:nil,userBacking:nil,assistant:turn)
 }
 static func rows(_ name:String)->[NativeLiveConversationRowPresentation] {
  if name=="user-assistant" {return [row("user-short"),row("assistant-plain")]}
  if name=="assistant-user" {return [row("assistant-plain"),row("user-short")]}
  if name=="multiple" {return [row("user-short"),row("assistant-plain"),row("divider"),row("history-user")]}
  if name=="history-pagination" {return [row("divider"),row("history-user"),row("history-assistant")]}
  return [row(name)]
 }
 static func model(_ name:String)->AppModel {
  let model=AppModel()
  model.nativeLiveMessageUIState["user"].voiceTranscriptExpansion=name=="voice-expanded"
  if name=="assistant-activity" {model.nativeLiveMessageUIState["assistant"].activityExpansion = .userExpanded}
  if name=="mind" {model.mindWritesByMessageID["assistant"] = .init(messageId:"assistant",total:2,kinds:[.init(kind:.memory,count:2)])}
  return model
 }
 static func host(_ name:String,_ baseline:Bool)->AnyView {
  AnyView(VStack(alignment:.leading,spacing:ChatPresentationLayout.turnSpacing) {
   if name=="history-pagination" {Button("Load older messages") {}.font(.system(size:13.5)).rowsFrame("pagination")}
   ForEach(Array(rows(name).enumerated()),id:\.offset) { index,row in
    Group {
     if baseline {BaselineNativeLiveMessageRow(row:row,isCurrentHead:name != "noncurrent-head",isTurnInFlight:name=="retry-disabled"||name=="voice-editable-disabled",isCopied:name=="assistant-copied",onCopyMessage:{RowsProbe.trace.append("copy:\($0)")},onRetryMessage:{RowsProbe.trace.append("retry:\($0)")},onEditMessage:{RowsProbe.trace.append("edit:\($0.id)")},onResolveInteraction:{interaction,response in RowsProbe.trace.append("resolve:\(interaction.id):\(response)")})}
     else {NativeLiveMessageRow(row:row,isCurrentHead:name != "noncurrent-head",isTurnInFlight:name=="retry-disabled"||name=="voice-editable-disabled",isCopied:name=="assistant-copied",onCopyMessage:{RowsProbe.trace.append("copy:\($0)")},onRetryMessage:{RowsProbe.trace.append("retry:\($0)")},onEditMessage:{RowsProbe.trace.append("edit:\($0.id)")},onResolveInteraction:{interaction,response in RowsProbe.trace.append("resolve:\(interaction.id):\(response)")})}
    }.environment(\.rowsPrefix,"row.\(index).")
.rowsFrame("row.\(index)")
   }
  }.padding(.horizontal,ChatPresentationLayout.messageGutter).frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.topLeading))
 }
}
@MainActor enum RowsChecks {
 struct Sample {let frames:[String:CGRect];let pixels:[UInt8];let width:Int;let height:Int;let trace:[String];let voice:Bool;let enabled:[String:Bool];let contextDisabled:Bool;let contextText:String?}
 static func run(_ scene:UIWindowScene) async {
  let tablet=UIDevice.current.userInterfaceIdiom == .pad,width=tablet ? 1024:390,height=tablet ? 1400:1000
  var count=0,frames=0
  for dark in [false,true] {for name in RowsFixtures.cases {
   let base=await sample(RowsFixtures.host(name,true),scene,width,height,dark,RowsFixtures.model(name),name)
   let head=await sample(RowsFixtures.host(name,false),scene,width,height,dark,RowsFixtures.model(name),name)
   if !name.hasPrefix("voice") { compare(base,head,name+"/\(dark)") } // Intentional voice visual delta; all callbacks below still compared.
   precondition(base.trace==head.trace && base.voice==head.voice && base.enabled==head.enabled && base.contextDisabled==head.contextDisabled && base.contextText==head.contextText,"callback/state mismatch \(name)")
   if name=="retry-enabled" {precondition(head.trace==["copy:A fixture message.","retry:user"],"retry enabled trace=\(head.trace) flags=\(head.enabled) actions=\(RowsProbe.actions.keys)")}
   if name=="retry-disabled" {precondition(head.enabled["retry"]==false && head.trace==["copy:A fixture message."])}
   if name=="user-editable" {precondition(head.trace==["copy:A fixture message.","edit:user"])}
   if name.hasPrefix("voice") {precondition(head.voice != (name=="voice-expanded"))}
   frames+=base.frames.count;count+=1
   print("rows \(name)/\(dark): \(base.frames.count) frames; trace=\(head.trace); flags=\(head.enabled)");fflush(stdout)
  }}
  let base=await sample(AnyView(BaselineNativeLiveUserMessagePresentationView(presentation:RowsFixtures.row("user-short").user!,isVoiceTranscriptRevealed:.constant(false))),scene,width,height,false,RowsFixtures.model("user-short"),"negative")
  let bad=await sample(AnyView(RejectedNativeLiveUserMessagePresentationView(presentation:RowsFixtures.row("user-short").user!,isVoiceTranscriptRevealed:.constant(false))),scene,width,height,false,RowsFixtures.model("user-short"),"negative")
  precondition(base.frames != bad.frames,"negative inset not detected")
  if ProcessInfo.processInfo.environment["ROWS_NEGATIVE"]=="1" {compare(base,bad,"negative inset")}
  print("MessageRows equivalence PASS: \(count) cases / \(frames) frames; non-voice static pixel diff 0; callbacks same; negative inset detected; device=\(tablet ? "iPad":"iPhone")");fflush(stdout)
 }
 static func compare(_ base:Sample,_ head:Sample,_ name:String) {
  precondition(base.frames==head.frames,"frame mismatch \(name): \(base.frames) / \(head.frames)")
  precondition(base.pixels==head.pixels,"static pixel mismatch \(name)")
 }
 static func sample(_ content:AnyView,_ scene:UIWindowScene,_ width:Int,_ height:Int,_ dark:Bool,_ model:AppModel,_ name:String) async->Sample {
  RowsProbe.reset();let store=RowsFrameStore()
  let host=UIHostingController(rootView:content.environmentObject(model).environment(\.colorScheme,dark ? .dark:.light).onPreferenceChange(RowsFrames.self){store.frames=$0}.background(Color(.systemBackground))),window=UIWindow(windowScene:scene)
  window.frame=CGRect(x:0,y:0,width:width,height:height);window.overrideUserInterfaceStyle=dark ? .dark:.light;window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
  host.view.layoutIfNeeded();try? await Task.sleep(for:.milliseconds(600));host.view.layoutIfNeeded()
  let format=UIGraphicsImageRendererFormat();format.scale=1
  let image=UIGraphicsImageRenderer(bounds:window.bounds,format:format).image {_ in host.view.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
  var pixels=[UInt8](repeating:0,count:width*height*4)
  pixels.withUnsafeMutableBytes { bytes in let ctx=CGContext(data:bytes.baseAddress,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!;ctx.draw(image.cgImage!,in:window.bounds)}
  let frames=store.frames
  // Invoke closures captured from the actual compiled presentation. The label
  // modifier reads SwiftUI's real isEnabled environment before invocation.
  RowsProbe.invoke("copy");RowsProbe.invoke("retry")
  if let text=RowsProbe.contextText {RowsProbe.copy?(text)}
  if !RowsProbe.contextDisabled {RowsProbe.edit?()}
  let beforeTap=model.nativeLiveMessageUIState["user"].voiceTranscriptExpansion
  RowsProbe.tap?()
  if RowsProbe.contextTap != nil {precondition(model.nativeLiveMessageUIState["user"].voiceTranscriptExpansion==beforeTap,"editable SwiftUI tap must not toggle");RowsProbe.coordinator?.handleTap()}
  if let resolve=RowsProbe.resolve {
   let value=NativeLiveRuntimeInteractionSnapshot(interactionID:"interaction",prepareID:"prepare",kind:"permission",request:[:],status:"pending",response:nil,createdAt:"",updatedAt:"",resolvedAt:nil,cancelledAt:nil)
   try! await resolve(value,["approved":.bool(true)])
  }
  let result=Sample(frames:frames,pixels:pixels,width:width,height:height,trace:RowsProbe.trace,voice:model.nativeLiveMessageUIState["user"].voiceTranscriptExpansion,enabled:RowsProbe.enabled,contextDisabled:RowsProbe.contextDisabled,contextText:RowsProbe.contextText)
  window.isHidden=true;try? await Task.sleep(for:.milliseconds(100));return result
 }
}
final class RowsAppDelegate:NSObject,UIApplicationDelegate {
 func application(_ app:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration {let c=UISceneConfiguration(name:"Tests",sessionRole:session.role);c.delegateClass=RowsSceneDelegate.self;return c}
}
final class RowsSceneDelegate:NSObject,UIWindowSceneDelegate {
 var window:UIWindow?
 func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions) {guard let scene=scene as? UIWindowScene else{return};window=UIWindow(windowScene:scene);window?.rootViewController=UIViewController();window?.makeKeyAndVisible();DispatchQueue.main.asyncAfter(deadline:.now()+0.5) {Task {await RowsChecks.run(scene);exit(0)}}}
}
@main struct RowsApp {static func main(){UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(RowsAppDelegate.self))}}
