import Foundation
@main struct SpotifyChecks {
 static func value(_ json:String) -> NativeLiveJSONValue { try! JSONDecoder().decode(NativeLiveJSONValue.self,from:Data(json.utf8)) }
 static func main() {
  let entity = value(#"{"name":"Song","uri":"spotify:track:abc","url":"https://open.spotify.com/track/abc","entity_type":"track","creators":[{"name":"Artist"}],"parent":{"name":"Album"},"display":{"type_label":"Track","covers":[{"url":"https://example.invalid/small.png","size":"SMALL"},{"url":"https://example.invalid/large.png","size":"LARGE"}]}}"#)
  let output = NativeLiveJSONValue.object(["entities":.array([entity])])
  for identity in ["mcp__Spotify__search","mcp__Spotify__generate_playlist"] {
   let result = NativeLiveSpotifyProjector.project(providerToolName:identity,output:output)!
   precondition(result.entities.count == 1)
   precondition(result.entities[0].name == "Song" && result.entities[0].creator == "Artist")
   precondition(result.entities[0].url?.absoluteString == "https://open.spotify.com/track/abc")
   precondition(result.entities[0].coverURL?.absoluteString == "https://example.invalid/large.png")
   precondition(result.entities[0].parent == "Album" && result.entities[0].typeLabel == "Track")
  }
  for name in ["search","mcp__Foo__search","spotify_search","mcp__Spotify__future","mcp__spotify__search"] {
   precondition(NativeLiveSpotifyProjector.project(providerToolName:name,output:output) == nil,"unsafe identity \(name)")
  }
  let encoded=String(data:try! JSONEncoder().encode(output),encoding:.utf8)!
  for wrapped in [NativeLiveJSONValue.string(encoded), .array([.object(["type":.string("text"),"text":.string(encoded)])])] {
   precondition(NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__search",output:wrapped)?.entities.first?.name == "Song", "Known SDK tool-result text envelope must render")
   precondition(NativeLiveSpotifyProjector.project(providerToolName:"mcp__Foo__search",output:wrapped) == nil)
  }
  for wrapped in [NativeLiveJSONValue.string("not JSON"), .array([.object(["type":.string("image"),"text":.string(encoded)])]), .array([.object(["type":.string("text"),"text":.string(encoded)]),.object(["type":.string("text"),"text":.string(encoded)])]), .object(["text":.string(encoded)])] {
   precondition(NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__search",output:wrapped) == nil, "Unknown envelope must be generic")
  }
  let witness=try! JSONDecoder().decode(NativeLiveJSONValue.self,from:Data(contentsOf:URL(fileURLWithPath:"tests/fixtures/spotify-sdk-output.json"))).objectValue!["expected"]!.objectValue!
  precondition(NativeLiveSpotifyProjector.project(providerToolName:witness["providerToolName"]!.stringValue!,output:witness["output"])?.entities.first?.name == "SDK Song")
  let names = ["track","album","artist","playlist","show","episode","audiobook"]
  let mixed = names.map { NativeLiveJSONValue.object(["name":.string($0),"uri":.string("spotify:\($0):id")]) }
  let limited = NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__search",output:.object(["entities":.array(mixed)]))!
  precondition(limited.entities.map(\.name) == Array(names.prefix(5)))
  precondition(limited.entities.allSatisfy { $0.url == nil && $0.coverURL == nil })
  let playing = NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__get_currently_playing",output:.object(["currently_playing_entity":entity]))!
  precondition(playing.entities[0].name == "Song")
  precondition(NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__get_currently_playing",output:.object(["currently_playing_entity":.null]))?.isEmpty == true)
  let error = NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__search",output:value(#"{"is_error":true,"error":{"title":"Provider title","message":"Exact cause","error_code":"E42"}}"#))!
  precondition(error.errorTitle == "Provider title" && error.errorMessage == "Exact cause" && error.errorCode == "E42")
  for malformed in [#"{}"#,#"{"entities":{}}"#,#"{"entities":[{"uri":"spotify:track:x"}]}"#,#"{"entities":[{"name":"bad"}]}"#,#"{"entities":[{"name":"bad","url":"javascript:alert(1)"}]}"#,#"{"entities":[{"name":"bad","uri":"garbage"}]}"#,#"{"entities":[5]}"#,#"{"entities":[],"future":true}"#] {
   precondition(NativeLiveSpotifyProjector.project(providerToolName:"mcp__Spotify__search",output:value(malformed)) == nil,malformed)
  }
  print("Spotify projector PASS")
 }
}
