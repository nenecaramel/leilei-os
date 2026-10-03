import Foundation
func object(_ v:[String:NativeLiveJSONValue])->NativeLiveJSONValue { .object(v) }
func block(_ id:String,_ kind:String,_ payload:[String:NativeLiveJSONValue],_ ordinal:Int=0)->NativeLiveCurrentPathBlock {
 .init(id:id,ordinal:ordinal,kind:kind,rawType:kind,text:kind == "text" ? "Answer" : nil,payload:payload,createdAt:"")
}
func project(_ blocks:[NativeLiveCurrentPathBlock])->NativeLiveMessagePresentation {
 NativeLiveMessagePresentationProjector.project(.canonical(.init(id:"m",conversationId:"c",parentMessageId:nil,role:"assistant",status:"completed",createdAt:"",completedAt:nil,blocks:blocks)))
}
if CommandLine.arguments.contains("--review-json-budget") {
 let broad=NativeLiveStructuredJSON(object(Dictionary(uniqueKeysWithValues:(0..<8).map { ("array\($0)",.array(Array(repeating:.number(1),count:32))) })))
 precondition(broad.truncated)
 print("Structured presentation PASS"); exit(0)
}
if CommandLine.arguments.contains("--review-json-semantic") {
 for type in ["json","structured_output"] {
  let semantic=object(["type":.string(type),"value":.number(42),"label":.string("answer")])
  let projected=project([block("semantic","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array([object(["type":.string(type),"value":semantic])])])])]).nodes[0].children[0]
  precondition(projected.json?.value == semantic)
 }
 print("Structured presentation PASS"); exit(0)
}
let citation:NativeLiveJSONValue = object(["type":.string("web_search_result_location"),"encrypted_index":.string("provider-index"),"url":.string("https://example.test/a"),"title":.string("Source"),"cited_text":.string("real quote")])
let parts:[NativeLiveJSONValue] = [object(["type":.string("text"),"text":.string("Child text")]),object(["type":.string("json"),"value":object(["z":.null,"a":.array([.number(42),.bool(true)])])]),object(["type":.string("structured_output"),"value":object(["type":.string("structured_output"),"value":.null])]),object(["type":.string("search_result"),"value":object(["type":.string("search_result"),"source":.string("https://example.test/a"),"title":.string("Search"),"content":.array([object(["type":.string("text"),"text":.string("snippet")])])])]),object(["type":.string("citation"),"value":citation]),object(["type":.string("generated_file"),"materialization":.string("pending")]),object(["type":.string("resource_link"),"value":object(["uri":.string("ui://app"),"name":.string("Resource")])]),object(["type":.string("future_part"),"value":object(["secret":.string("DO_NOT_DUMP")])])]
let result = project([block("ledger","tool_result",[:]),block("result","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array(parts),"truncated":.bool(true),"redacted":.bool(true)])])])
precondition(result.nodes.count == 1 && NativeLiveMessageRendererRegistry.renderer(for:result.nodes[0]) == .structuredResult)
let node=result.nodes[0]
precondition(node.children.count == 8 && node.children.map(\.kind) == [.markdown,.structuredJSON,.structuredJSON,.searchResult,.citation,.unknown,.unknown,.unknown])
precondition(node.children.allSatisfy { $0.canonicalIdentity == "canonical_tool_result" })
precondition(Set(node.children.map(\.id)).count == 8)
precondition(node.structuredStatus?.truncated == true && node.structuredStatus?.redacted == true)
precondition(node.children[1].json?.fields.map(\.key) == ["a","z"])
precondition(node.children[1].json?.copyJSON.contains("42") == true)
precondition(node.children[3].search?.snippet == "snippet")
precondition(node.children[3].search?.citations.count == 1)
precondition(node.children[4].citations[0].quote == "real quote")
precondition(node.children[5].fallback.diagnostic == "MEDIA_PENDING")
precondition(node.children[6].fallback.metadata["capability"] == "reference_only")
precondition(!node.children[7].fallback.metadata.values.contains("DO_NOT_DUMP"))
let cited = project([block("t","text",["citations":object(["schema_version":.number(1),"compatibility_payload":object(["schema_version":.number(1),"payload":.array([citation,citation,object(["url":.string("https://only.test")]),.null])])])])])
precondition(cited.nodes[0].citations.count == 3 && cited.citationSources.count == 2)
precondition(cited.citationSources[0].relations.count == 2 && cited.citationSources[1].title == nil)
precondition(cited.copyText == "Answer")
for url in ["file:///x","javascript:alert(1)","data:text/html,x","ui://app","custom://x"] { precondition(NativeLiveLinkCapability.openableURL(url) == nil) }
precondition(NativeLiveLinkCapability.openableURL("https://example.test") != nil)
let ref=object(["type":.string("attachment_ref"),"entity_id":.string("owned")])
let filePart=object(["type":.string("generated_file"),"ref":ref,"materialization":.string("materialized"),"value":object(["generation_origin":.string("provider_generated")])])
func media(_ refs:[NativeLiveJSONValue],_ descriptors:[NativeLiveJSONValue])->NativeLiveVisualNode {
 project([block("media","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"refs":.array(refs),"materialized_attachments":.array(descriptors),"structured":object(["schema_version":.number(1),"parts":.array([filePart])])])]).nodes[0].children[0]
}
precondition(media([ref],[]).attachment == nil)
let descriptor=object(["attachment_id":.string("owned"),"filename":.string("report.pdf"),"mime_type":.string("application/pdf"),"size_bytes":.number(3),"sha256":.string(String(repeating:"a",count:64)),"materialization":.string("ready")])
let materialized=media([ref],[descriptor])
precondition(materialized.attachment?.entityID == "owned" && NativeLiveMessageRendererRegistry.renderer(for:materialized) == .attachment)
precondition(materialized.attachment?.metadata["provenance"]?.objectValue?["generation_origin"]?.stringValue == "provider_generated")
precondition(media([],[descriptor]).attachment == nil)
let empty = project([block("ordinary","tool_result",["structured":object(["parts":.array(parts)])]),block("q","tool_use",[:])])
precondition(empty.nodes.isEmpty && empty.copyText == nil)
let duplicate=project([block("duplicate","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array([parts[4],parts[4]])])])]).nodes[0]
precondition(duplicate.children[0].citationSourcesToRender?.count == 1 && duplicate.children[0].citationSourcesToRender?[0].relations.count == 2)
precondition(duplicate.children[1].citations.count == 1 && duplicate.children[1].citationSourcesToRender?.isEmpty == true)
for scalar:NativeLiveJSONValue in [.null,.bool(false),.number(42),.string("value"),.array([.null])] { precondition(!NativeLiveStructuredJSON(scalar).copyJSON.isEmpty) }
var deep:NativeLiveJSONValue = .number(1)
for _ in 0..<20 { deep=object(["child":deep]) }
precondition(NativeLiveStructuredJSON(deep).truncated)
for type in ["image","document","generated_file"] {
 let pending=project([block(type,"canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array([object(["type":.string(type),"materialization":.string("pending"),"media_type":.string("application/pdf")])])])])]).nodes[0].children[0]
 precondition(pending.attachment == nil && pending.fallback.diagnostic == "MEDIA_PENDING")
}
let minimal=NativeLiveSearchResultPresentation(object(["source":.string("https://minimal.test")]))
precondition(minimal.title == nil && minimal.snippet == nil && minimal.url == "https://minimal.test")
precondition(NativeLiveCitationRelation(.null) == nil && NativeLiveCitationRelation(object(["title":.string("Not an identity")])) == nil)
precondition(NativeLiveLinkCapability.openableURL("http://example.test") != nil)
let localRelation=project([block("local-citation","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array([object(["type":.string("search_result"),"value":object(["source":.string("https://example.test/a"),"citation_relations":.array([citation])])])])])])]).nodes[0]
precondition(localRelation.children[0].search?.citations.count == 1)
precondition(localRelation.children[0].citationSourcesToRender?.count == 1)
let broad=NativeLiveStructuredJSON(object(Dictionary(uniqueKeysWithValues:(0..<8).map { ("array\($0)",.array(Array(repeating:.number(1),count:32))) })))
precondition(broad.truncated)
for type in ["json","structured_output"] {
 let semantic=object(["type":.string(type),"value":.number(42),"label":.string("answer")])
 let projected=project([block("semantic","canonical_tool_result",["schema_version":.number(1),"identity":.string("canonical_tool_result"),"structured":object(["schema_version":.number(1),"parts":.array([object(["type":.string(type),"value":semantic])])])])]).nodes[0].children[0]
 precondition(projected.json?.value == semantic)
}
if CommandLine.arguments.count > 1 {
 let durable=try JSONDecoder().decode([NativeLiveCurrentPathBlock].self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
 let children=project(durable).nodes.first(where:{$0.kind == .canonicalToolResult})!.children
 precondition(children[0].search?.snippet == "durable snippet")
 precondition(children[1].citations[0].quote == "durable quote")
 precondition(children[2].json?.value.objectValue?["outer"]?.objectValue?["inner"]?.numberValue == 42)
 precondition(children[3].json?.value.objectValue?["label"]?.stringValue == "answer")
 print("Durable structured presentation PASS")
}
print("Structured presentation PASS")
