import Foundation

enum NativeLiveLinkCapability {
    static func openableURL(_ value:String?) -> URL? {
        guard let value, let url=URL(string:value), ["http","https"].contains(url.scheme?.lowercased() ?? ""),
              let host=url.host, !host.isEmpty, url.user == nil, url.password == nil else { return nil }
        return url
    }
}
struct NativeLiveCitationRelation: Equatable, Sendable {
    let sourceKey: String
    let fields: [String:NativeLiveJSONValue]
    var title:String? { fields["title"]?.stringValue ?? fields["document_title"]?.stringValue }
    var url:String? { fields["url"]?.stringValue ?? fields["source"]?.stringValue }
    var quote:String? { fields["cited_text"]?.stringValue ?? fields["quote"]?.stringValue }
    var providerID:NativeLiveJSONValue? { fields["id"] ?? fields["citation_id"] ?? fields["encrypted_index"] }
    init?(_ value:NativeLiveJSONValue) {
        guard let raw=value.objectValue else { return nil }
        var known:[String:NativeLiveJSONValue]=[:]
        for key in ["type","id","citation_id","index","encrypted_index","title","document_title","url","source","cited_text","quote","file_id","document_index","search_result_index","start_char_index","end_char_index","start_page_number","end_page_number","start_block_index","end_block_index"] {
            if let text=raw[key]?.stringValue, !text.isEmpty { known[key] = .string(String(text.prefix(8000))) }
            else if let n=raw[key]?.numberValue,n.isFinite { known[key] = .number(n) }
        }
        let key:String
        if let url=known["url"]?.stringValue ?? known["source"]?.stringValue { key="url:"+url }
        else if let id=known["id"]?.stringValue ?? known["citation_id"]?.stringValue ?? known["encrypted_index"]?.stringValue { key="provider:"+id }
        else if let file=known["file_id"]?.stringValue { key="document:"+file }
        else if let index=known["document_index"]?.numberValue { key="document_index:\(index)" }
        else if let index=known["search_result_index"]?.numberValue { key="search_result_index:\(index)" }
        else { return nil }
        fields=known; sourceKey=key
    }
    static func parse(_ envelope:NativeLiveJSONValue?) -> [Self] {
        guard let envelope else { return [] }
        // A wraps the bridge's bounded citation envelope once more at the writer.
        let value=envelope.objectValue?["compatibility_payload"] ?? envelope
        let payload=value.objectValue?["payload"] ?? value
        return (payload.arrayValue ?? [payload]).prefix(32).compactMap(Self.init)
    }
}
struct NativeLiveCitationSource: Identifiable, Equatable, Sendable {
    let id:String
    let title:String?
    let url:String?
    var relations:[NativeLiveCitationRelation]
    static func aggregate(_ relations:[NativeLiveCitationRelation]) -> [Self] {
        var sources:[Self]=[]
        for relation in relations {
            if let index=sources.firstIndex(where:{$0.id == relation.sourceKey}) { sources[index].relations.append(relation) }
            else { sources.append(.init(id:relation.sourceKey,title:relation.title,url:relation.url,relations:[relation])) }
        }
        return sources
    }
}
struct NativeLiveSearchResultPresentation: Equatable, Sendable {
    let title:String?
    let source:String?
    let url:String?
    let snippet:String?
    var citations:[NativeLiveCitationRelation]
    init(_ value:NativeLiveJSONValue) {
        let v=value.objectValue ?? [:]
        func text(_ key:String)->String? { v[key]?.stringValue.map { String($0.prefix(8000)) } }
        title=text("title"); source=text("source"); url=text("url") ?? text("source")
        snippet=text("snippet") ?? text("cited_text") ?? v["content"]?.arrayValue?.prefix(32).compactMap { $0.objectValue?["text"]?.stringValue }.joined(separator:"\n").prefix(8000).description
        citations=NativeLiveCitationRelation.parse(v["citation_relations"] ?? v["citations"])
    }
}
extension NativeLiveMessagePresentation {
    var citationSources:[NativeLiveCitationSource] { NativeLiveCitationSource.aggregate(nodes.filter {$0.canonicalIdentity == "text"}.flatMap(\.citations)) }
}
