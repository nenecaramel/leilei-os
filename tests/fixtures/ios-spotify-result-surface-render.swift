import SwiftUI
import UIKit

struct SpotifyFrames: PreferenceKey {
 static var defaultValue:[String:CGRect]=[:]
 static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]) {value.merge(nextValue()) {_,new in new}}
}
struct SpotifyItems: PreferenceKey {
 static var defaultValue:[String:NativeLiveSpotifyResultSurfaceItem]=[:]
 static func reduce(value:inout [String:NativeLiveSpotifyResultSurfaceItem],nextValue:()->[String:NativeLiveSpotifyResultSurfaceItem]) {value.merge(nextValue()) {_,new in new}}
}
extension View {
 func spotifyItem(_ item:NativeLiveSpotifyResultSurfaceItem)->some View {background(Color.clear.preference(key:SpotifyItems.self,value:[item.id:item]))}
 func spotifyFrame(_ name:String)->some View {background(GeometryReader { g in Color.clear.preference(key:SpotifyFrames.self,value:[name:g.frame(in:.global)])})}
}
@MainActor enum SpotifyProbe {
 static var actions:[String:()->Void]=[:]
 static var lastDetails:[String?]?
 static var dismiss:(()->Void)?
 static func observeDetails(_ values:[String?],dismiss:@escaping ()->Void) {lastDetails=values;self.dismiss=dismiss}
 static func capture(_ name:String,_ action:@escaping ()->Void)->()->Void {actions[name]=action;return action}
}
@MainActor final class SpotifyFrameStore {var values:[String:CGRect]=[:];var items:[String:NativeLiveSpotifyResultSurfaceItem]=[:]}
@MainActor enum SpotifyRender {
 static let date="2026-10-06T00:00:00Z"
 static let entity:NativeLiveJSONValue = .object(["name":.string("Song"),"uri":.string("spotify:track:song"),"creators":.array([.object(["name":.string("Artist")])]),"parent":.object(["name":.string("Album")])])
 static func turn(_ name:String)->NativeLiveAssistantTurnPresentation {
  var blocks:[NativeLiveCurrentPathBlock]=[]
  func block(_ kind:String,_ payload:[String:NativeLiveJSONValue]) {blocks.append(.init(id:"b\(blocks.count)",ordinal:blocks.count,kind:kind,rawType:kind,text:nil,payload:payload,createdAt:date))}
  block("tool_use",["tool_use_id":.string("toolsearch"),"tool_name":.string("ToolSearch"),"input":.object([:])])
  block("tool_result",["tool_use_id":.string("toolsearch"),"output":.string("Found tools")])
  let names = name=="none" ? [] : name=="multiple" ? ["error","search"] : ["search"]
  for id in names {
   block("tool_use",["tool_use_id":.string(id),"tool_name":.string(id=="error" ? "mcp__Spotify__get_currently_playing":"mcp__claude_ai_Spotify__search"),"input":.object(["query":.string("Song")])])
   let result:NativeLiveJSONValue = id=="error" ? .object(["is_error":.bool(true),"error":.object(["error_code":.string("LICENSOR_RESTRICTED")])]) : .object(["entities":.array(Array(repeating:entity,count:name=="multiple" ? 3:1))])
   block("tool_result",["tool_use_id":.string(id),"output":result,"resource_links":.array([.object(["uri":.string("https://example.invalid/resource")])])])
  }
  blocks.append(.init(id:"text",ordinal:blocks.count,kind:"text",rawType:"text",text:"Assistant response",payload:nil,createdAt:date))
  let permission=NativeLiveRuntimeInteractionSnapshot(interactionID:"permission",prepareID:"prepare",kind:"permission",request:["toolUseId":.string("search"),"toolName":.string("Spotify search")],status:"resolved",response:["decision":.string("allow")],createdAt:date,updatedAt:date,resolvedAt:date,cancelledAt:nil)
  let message=NativeLiveCurrentPathMessage(id:"assistant",conversationId:"00000000-0000-0000-0000-000000000123",parentMessageId:"user",role:"assistant",status:"completed",createdAt:date,completedAt:date,blocks:blocks,activity:.init(prepareId:"prepare",events:[],interactions:names.isEmpty ? []:[permission],durationMs:94000))
  return .init(stableID:"assistant",canonicalMessageID:nil,prepareID:nil,requestID:nil,parentUserMessageID:"user",phase:.completed,timestamp:date,bodyPresentation:NativeLiveMessagePresentationProjector.project(.canonical(message)),activityProjection:.init(message:message),duration:94,header:"Worked for 94s · \(names.count+1) steps",failure:nil)
 }
 struct Sample {let frames:[String:CGRect];let png:Data;let pixels:Data;let items:[String:NativeLiveSpotifyResultSurfaceItem]}
 static func sample(_ scene:UIWindowScene,_ name:String,_ expanded:Bool,_ dark:Bool,_ baseline:Bool=false) async -> Sample {
  print("SAMPLE \(name) expanded=\(expanded) dark=\(dark) baseline=\(baseline)");fflush(stdout)
  let model=AppModel();model.nativeLiveMessageUIState["assistant"].activityExpansion=expanded ? .userExpanded:.userCollapsed
  let turn=turn(name),store=SpotifyFrameStore()
  let content:AnyView = baseline ? AnyView(BaselineAssistantTurnRow(turn:turn,isCurrentHead:false,isTurnInFlight:false,isCopied:false,onCopyMessage:{_ in},onRetryMessage:{_ in},onResolveInteraction:{_,_ in})) : AnyView(NativeLiveAssistantTurnRow(turn:turn,isCurrentHead:false,isTurnInFlight:false,isCopied:false,onCopyMessage:{_ in},onRetryMessage:{_ in},onResolveInteraction:{_,_ in}))
  let host=UIHostingController(rootView:VStack {content;Spacer()}.padding(16).environmentObject(model).environment(\.colorScheme,dark ? .dark:.light).onPreferenceChange(SpotifyFrames.self) {store.values=$0}.onPreferenceChange(SpotifyItems.self) {store.items=$0})
  let width=UIDevice.current.userInterfaceIdiom == .pad ? 768:390
  let window=UIWindow(windowScene:scene);window.frame=CGRect(x:0,y:0,width:width,height:1200);window.overrideUserInterfaceStyle=dark ? .dark:.light;window.rootViewController=host;window.makeKeyAndVisible();host.view.frame=window.bounds
  try? await Task.sleep(for:.milliseconds(350));host.view.layoutIfNeeded()
  let format=UIGraphicsImageRendererFormat();format.scale=1
  let image=UIGraphicsImageRenderer(bounds:window.bounds,format:format).image {_ in host.view.drawHierarchy(in:window.bounds,afterScreenUpdates:true)}
  print("FRAMES \(store.values)");fflush(stdout)
  let capturedFrames=store.values
  if !baseline && name=="search" && expanded {
   for key in ["info","generic-"+turn.activityProjection.tools.first {$0.id=="search"}!.toolName] {
    SpotifyProbe.lastDetails=nil
    print("DETAILS \(key)");fflush(stdout)
    precondition(SpotifyProbe.actions[key] != nil,"Missing details entry \(key)");SpotifyProbe.actions[key]?()
    try? await Task.sleep(for:.milliseconds(500));precondition(host.presentedViewController != nil,"Tool details did not open")
    print("DETAIL VALUES \(SpotifyProbe.lastDetails as Any)");fflush(stdout)
    let source=turn.activityProjection.tools.first {$0.id=="search"}!
    precondition(SpotifyProbe.lastDetails == [nativeLiveToolDisplayName(source.toolName),"Done","Input",nativeLiveJSONDetail(source.input),"Output",nativeLiveJSONDetail(source.output),"Resources",nativeLiveJSONDetail(.array(source.resourceLinks))],"Details authority changed at \(key)")
    SpotifyProbe.dismiss?();try? await Task.sleep(for:.milliseconds(500))
   }
  }
  let result=Sample(frames:capturedFrames,png:image.pngData()!,pixels:Data(image.cgImage!.dataProvider!.data! as Data),items:store.items)
  window.isHidden=true;window.rootViewController=nil;return result
 }
 static func run(_ scene:UIWindowScene) async {
  let root=FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0].appendingPathComponent("SpotifySurface");try! FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
  var manifest:[String:[String:[Double]]]=[:]
  for dark in [false,true] {
   for name in ["search","multiple","none"] {
    let collapsed=await sample(scene,name,false,dark),expanded=await sample(scene,name,true,dark)
    if name=="none" {
     for (value,isExpanded) in [(collapsed,false),(expanded,true)] {
      let base=await sample(scene,name,isExpanded,dark,true)
      precondition(value.frames==base.frames && value.pixels==base.pixels,"No-Spotify geometry/pixels changed")
     }
    } else {
     let count=name=="multiple" ? 2:1
     let keys=collapsed.frames.keys.filter {$0.hasPrefix("card-")}
     precondition(keys.count==count && expanded.frames.keys.filter {$0.hasPrefix("card-")}.count==count,"Collapse hid Spotify result")
     precondition(collapsed.items==expanded.items && collapsed.items.count==count,"Rendered card content changed on expansion")
     for key in keys {
      precondition(collapsed.frames[key]!.size==expanded.frames[key]!.size,"Card geometry/content changed on expansion")
      for sample in [collapsed,expanded] {precondition(sample.frames[key]!.minY >= sample.frames["activity"]!.maxY && sample.frames[key]!.maxY <= sample.frames["body"]!.minY,"Wrong surface order")}
     }
     if name=="multiple" {precondition(collapsed.frames["card-error"]!.maxY <= collapsed.frames["card-search"]!.minY)}
    }
    for (sample,mode) in [(collapsed,"collapsed"),(expanded,"expanded")] {
     let key="\(name)-\(mode)-\(dark ? "dark":"light")";try! sample.png.write(to:root.appendingPathComponent(key+".png"))
     manifest[key]=sample.frames.mapValues {[Double($0.minX),Double($0.minY),Double($0.width),Double($0.height)]}
    }
   }
  }
  try! JSONSerialization.data(withJSONObject:manifest,options:[.prettyPrinted,.sortedKeys]).write(to:root.appendingPathComponent("manifest.json"))
  print("Spotify surface render PASS: 12 snapshots, collapsed/expanded cards, both details, no-Spotify exact pixels, device=\(UIDevice.current.userInterfaceIdiom)");fflush(stdout);exit(0)
 }
}
final class SpotifyAppDelegate:NSObject,UIApplicationDelegate {func application(_ application:UIApplication,configurationForConnecting session:UISceneSession,options:UIScene.ConnectionOptions)->UISceneConfiguration {let c=UISceneConfiguration(name:"Spotify tests",sessionRole:session.role);c.delegateClass=SpotifySceneDelegate.self;return c}}
final class SpotifySceneDelegate:NSObject,UIWindowSceneDelegate {func scene(_ scene:UIScene,willConnectTo session:UISceneSession,options:UIScene.ConnectionOptions) {guard let scene=scene as? UIWindowScene else{return};Task {@MainActor in await SpotifyRender.run(scene)}}}
@main struct SpotifySurfaceApp {static func main() {UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(SpotifyAppDelegate.self))}}
