import Foundation
@main struct SpotifySurfaceChecks {
 static let entity: NativeLiveJSONValue = .object(["name":.string("Song"),"uri":.string("spotify:track:id")])
 static let output: NativeLiveJSONValue = .object(["entities":.array([entity])])
 static func tool(_ id: String, _ name: String, _ order: Int, _ output: NativeLiveJSONValue? = output, state: NativeLiveToolCallState = .completed, parent: String? = nil) -> NativeLiveTurnActivityProjection.ToolActivity {
  .init(id:id,toolName:"Display name",providerToolName:name,questionMetadata:nil,input:.object(["query":.string("Song")]),output:output,resourceLinks:[.string("resource")],parentToolUseID:parent,parentAgentID:nil,hiddenFromTranscript:false,hiddenFromActivity:false,state:state,order:order)
 }
 static func main() {
  for name in ["mcp__Spotify__search","mcp__Spotify__generate_playlist","mcp__claude_ai_Spotify__search","mcp__claude_ai_Spotify__generate_playlist"] {
   let source = tool("one",name,18)
   let result = NativeLiveSpotifyResultSurfaceProjector.project(tools:[source])
   precondition(result.count==1 && result[0].tool==source && result[0].id==source.id && result[0].order==18)
   precondition(result[0].presentation.entities[0].url==nil)
  }
  for name in ["mcp__Spotify__get_currently_playing","mcp__claude_ai_Spotify__get_currently_playing"] {
   precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("current",name,1,.object(["currently_playing_entity":entity]))]).count==1)
   precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("empty",name,1,.object(["currently_playing_entity":.null]))])[0].presentation.isEmpty)
  }
  for name in ["mcp__Spotify__future","mcp__Spotify__search_extra","prefix_mcp__Spotify__search","mcp__spotify__search","mcp__Notion__search","mcp__Gmail__search","mcp__GitHub__search","mcp__ElevenLabs__search","ToolSearch"] {
   precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("unknown",name,1)]).isEmpty,"fuzzy capture")
  }
  precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("running","mcp__Spotify__search",1,state:.running)]).isEmpty)
  for invalid in [NativeLiveJSONValue.string("bad JSON"), .object(["entities":.array([.object(["name":.string("invalid")])])]), .object(["unknown":.string("envelope")])] {
   precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("bad","mcp__Spotify__search",1,invalid)]).isEmpty)
  }
  let error: NativeLiveJSONValue = .object(["is_error":.bool(true),"error":.object(["error_code":.string("LICENSOR_RESTRICTED")])])
  let ordered = NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("playlist","mcp__Spotify__generate_playlist",25),tool("search","mcp__Spotify__search",18,parent:"task"),tool("error","mcp__Spotify__get_currently_playing",12,error,state:.failed)])
  precondition(ordered.map(\.order)==[12,18,25] && ordered.map(\.id)==["error","search","playlist"],"Multiple result order/count lost")
  precondition(ordered[0].presentation.errorCode=="LICENSOR_RESTRICTED" && ordered[0].tool.state == .failed)
  precondition(ordered[1].tool.parentToolUseID=="task")
  let limited = NativeLiveSpotifyResultSurfaceProjector.project(tools:[tool("limit","mcp__Spotify__search",1,.object(["entities":.array(Array(repeating:entity,count:8))]))])
  precondition(limited[0].presentation.entities.count==5)
  func event(_ type: String, _ payload: [String:NativeLiveJSONValue], _ sequence: Int) -> NativeLiveRuntimeEventSnapshot { .init(sequence:sequence,event:.init(type:type,providerSessionID:nil,payload:payload),createdAt:"2026-10-06T00:00:00Z") }
  let use:[String:NativeLiveJSONValue] = ["tool_use_id":.string("spotify"),"tool_name":.string("mcp__claude_ai_Spotify__search"),"input":.object([:])]
  let result:[String:NativeLiveJSONValue] = ["tool_use_id":.string("spotify"),"output":output]
  let live = NativeLiveTurnActivityProjection(runtimeSurface:.init(prepareID:"p",conversationID:UUID(),events:[event("tool_use",use,1),event("tool_result",result,2)],interactions:[],controls:[],nextAfterSequence:2))
  // Reopen through the real canonical-message wire decoder, with no overlay.
  let persisted: NativeLiveJSONValue = .object([
   "id":.string("a"),"conversationId":.string("c"),"role":.string("assistant"),"status":.string("completed"),"createdAt":.string(""),
   "blocks":.array([
    .object(["id":.string("use"),"ordinal":.number(1),"kind":.string("tool_use"),"rawType":.string("tool_use"),"payload":.object(use),"createdAt":.string("")]),
    .object(["id":.string("result"),"ordinal":.number(2),"kind":.string("tool_result"),"rawType":.string("tool_result"),"payload":.object(result),"createdAt":.string("")])
   ])
  ])
  let reopened = try! JSONDecoder().decode(NativeLiveCurrentPathMessage.self,from:JSONEncoder().encode(persisted))
  let durable = NativeLiveTurnActivityProjection(message:reopened)
  precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:live.tools)==NativeLiveSpotifyResultSurfaceProjector.project(tools:durable.tools))
  let reconciled = NativeLiveTurnActivityProjection(durable:durable,overlay:live,active:false,elapsed:nil)
  precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:reconciled.tools)==NativeLiveSpotifyResultSurfaceProjector.project(tools:durable.tools))
  let suppressed = NativeLiveTurnActivityProjection(durable:durable,overlay:live,active:false,elapsed:nil,suppressedTools:["spotify"])
  precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:suppressed.tools).isEmpty,"Suppressed Spotify tool revived")
  for flag in ["hidden_from_transcript", "hidden_from_activity"] {
  let hiddenUse=use.merging([flag:.bool(true)]) {_,new in new}
  let hidden = NativeLiveTurnActivityProjection(runtimeSurface:.init(prepareID:"p",conversationID:UUID(),events:[event("tool_use",hiddenUse,1),event("tool_result",result,2)],interactions:[],controls:[],nextAfterSequence:2))
  precondition(NativeLiveSpotifyResultSurfaceProjector.project(tools:hidden.tools).isEmpty)
  }
  print("Spotify surface PASS")
 }
}
