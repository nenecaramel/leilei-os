import Foundation

struct NativeLiveStructuredResultStatus: Equatable, Sendable {
    let truncated:Bool
    let redacted:Bool
    let diagnostic:String?
}
enum NativeLiveStructuredToolResultProjector {
    static func project(_ block:NativeLiveCurrentPathBlock) -> (NativeLiveStructuredResultStatus,[NativeLiveVisualNode]) {
        let payload=block.payload ?? [:]
        let envelope=payload["structured"]?.objectValue ?? [:]
        let structured=envelope["compatibility_payload"]?.objectValue ?? envelope
        guard payload["schema_version"]?.numberValue == 1, payload["identity"]?.stringValue == "canonical_tool_result",
              structured["schema_version"]?.numberValue == 1, let parts=structured["parts"]?.arrayValue else {
            return (.init(truncated:payload["truncated"]?.boolValue == true,redacted:false,diagnostic:"Unsupported structured result contract"),[])
        }
        var nodes=parts.prefix(32).enumerated().map { index,part in child(part,index:index,parent:block) }
        let sources=NativeLiveCitationSource.aggregate(nodes.flatMap { $0.citations + ($0.search?.citations ?? []) })
        for index in nodes.indices {
            if let url=nodes[index].search?.url {
                nodes[index].search?.citations=sources.filter { $0.id == "url:"+url }.flatMap(\.relations)
            }
        }
        var displayed=Set<String>()
        for index in nodes.indices where !nodes[index].citations.isEmpty || nodes[index].search != nil {
            nodes[index].citationSourcesToRender=sources.filter { source in
                (nodes[index].citations + (nodes[index].search?.citations ?? [])).contains { $0.sourceKey == source.id } && displayed.insert(source.id).inserted
            }
        }
        let status=NativeLiveStructuredResultStatus(truncated:payload["truncated"]?.boolValue == true || envelope["truncated"]?.boolValue == true || structured["truncated"]?.boolValue == true || parts.count > 32 || nodes.contains {$0.json?.truncated == true},
            redacted:envelope["redacted"]?.boolValue == true || structured["redacted"]?.boolValue == true,diagnostic:parts.isEmpty ? "No result content available" : nil)
        return (status,nodes)
    }
    private static func child(_ part:NativeLiveJSONValue,index:Int,parent:NativeLiveCurrentPathBlock)->NativeLiveVisualNode {
        let p=part.objectValue ?? [:], type=p["type"]?.stringValue ?? "unknown"
        let value=p["value"] ?? .null
        var available:[String:String]=[:]
        for key in ["filename","mime_type","media_type","materialization","title","uri"] {
            if let text=p[key]?.stringValue ?? value.objectValue?[key]?.stringValue { available[key]=String(text.prefix(180)) }
        }
        var node=NativeLiveVisualNode(kind:.unknown,text:nil,sourceBlock:parent,attachment:nil,
            fallback:.init(title:"Unsupported result content",rawType:String((p["raw_type"]?.stringValue ?? type).prefix(128)),diagnostic:String((p["diagnostic_code"]?.stringValue ?? "UNSUPPORTED_RESULT_CONTENT").prefix(180)),metadata:available))
        node.presentationID="\(parent.id):part:\(index)"
        var provenance=parent.payload?["provenance"]?.objectValue ?? [:]
        let partValue=value.objectValue ?? [:]
        for key in ["generation_origin","origin","raw_type"] {
            if let field=p[key] ?? partValue[key] { provenance[key]=NativeLiveStructuredJSON(field).value }
        }
        if provenance["raw_type"] == nil { provenance["raw_type"] = .string(type) }
        node.partProvenance = .object(provenance)
        switch type {
        case "text":
            if let text=p["text"]?.stringValue ?? value.objectValue?["text"]?.stringValue, !text.isEmpty { node.kind = .markdown; node.text=String(text.prefix(8000)) }
        case "json","structured_output":
            node.kind = .structuredJSON
            // The normalized part value is semantic JSON. Its own type/value keys
            // do not authorize unwrapping or removal of business fields.
            node.json=NativeLiveStructuredJSON(value)
        case "search_result": node.kind = .searchResult; node.search = .init(value)
        case "citation":
            if let citation=NativeLiveCitationRelation(value.objectValue?["citation"] ?? value) { node.kind = .citation; node.citations=[citation] }
        case "image","document","generated_file":
            let ref=p["ref"]?.objectValue ?? value.objectValue?["ref"]?.objectValue
            let id=ref?["entity_id"]?.stringValue
            let allowed=parent.payload?["refs"]?.arrayValue?.contains { $0.objectValue?["type"]?.stringValue == "attachment_ref" && $0.objectValue?["entity_id"]?.stringValue == id } == true
            let metadata=parent.payload?["materialized_attachments"]?.arrayValue?.first { $0.objectValue?["attachment_id"]?.stringValue == id }?.objectValue
            if ref?["type"]?.stringValue == "attachment_ref", let id,!id.isEmpty,allowed,let metadata,metadata["materialization"]?.stringValue == "ready" {
                node.kind = .attachment
                var descriptor=metadata
                descriptor["provenance"]=node.provenance
                descriptor["refs"] = .array([.object(ref!)])
                node.attachment = .init(entityID:id,draftID:node.id,filename:metadata["filename"]?.stringValue ?? "Attachment",mimeType:metadata["mime_type"]?.stringValue ?? "application/octet-stream",kind:metadata["kind"]?.stringValue ?? "file",materialization:"ready",metadata:descriptor,source:.authoritative)
            } else {
                var metadata:[String:String]=["materialization":id == nil ? "pending" : "unavailable"]
                if let mime=p["media_type"]?.stringValue { metadata["mime_type"]=String(mime.prefix(180)) }
                if let length=p["byte_length"]?.numberValue,length.isFinite { metadata["byte_length"]=String(length) }
                node.fallback = .init(title:"Result file unavailable",rawType:type,diagnostic:id == nil ? "MEDIA_PENDING" : "ATTACHMENT_REF_UNAVAILABLE",metadata:metadata)
            }
        case "resource","resource_link":
            var metadata=["capability":"reference_only"]
            for key in ["uri","name","title","description","mimeType"] { if let text=value.objectValue?[key]?.stringValue { metadata[key]=String(text.prefix(180)) } }
            node.fallback = .init(title:"Resource reference",rawType:type,diagnostic:"REFERENCE_ONLY",metadata:metadata)
        default: break
        }
        return node
    }
}
