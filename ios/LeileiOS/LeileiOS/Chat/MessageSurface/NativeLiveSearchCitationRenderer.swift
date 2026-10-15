import SwiftUI

struct NativeLiveSearchResultView: View {
    let result:NativeLiveSearchResultPresentation
    var sources:[NativeLiveCitationSource]? = nil
    var body: some View {
        VStack(alignment:.leading,spacing:6) {
            Label("Search result",systemImage:"magnifyingglass").font(.caption).foregroundStyle(.secondary)
            if let title=result.title { Text(title).font(.subheadline.weight(.medium)).textSelection(.enabled) }
            NativeLiveSourceLink(title:nil,value:result.url)
            if let source=result.source, source != result.url { Text(source).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
            if let snippet=result.snippet,!snippet.isEmpty { Text(snippet).font(.subheadline).textSelection(.enabled) }
            NativeLiveCitationSourcesView(sources:sources ?? NativeLiveCitationSource.aggregate(result.citations))
        }.padding(10)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.045,
            originalCornerRadius: 11
        ))
    }
}
struct NativeLiveSourceLink: View {
    let title:String?
    let value:String?
    var body: some View {
        if let value {
            if let url=NativeLiveLinkCapability.openableURL(value) {
                Link(title ?? url.host ?? value,destination:url).font(.caption).lineLimit(3)
            } else {
                VStack(alignment:.leading,spacing:2) {
                    Text(title ?? value).font(.caption).textSelection(.enabled)
                    Text("Link unavailable").font(.caption2).foregroundStyle(.secondary)
                }
            }
        } else if let title { Text(title).font(.caption).textSelection(.enabled) }
    }
}
struct NativeLiveCitationSourcesView: View {
    let sources:[NativeLiveCitationSource]
    var body: some View {
        if !sources.isEmpty {
            VStack(alignment:.leading,spacing:8) {
                Text("Sources").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                ForEach(sources) { source in
                    VStack(alignment:.leading,spacing:4) {
                        NativeLiveSourceLink(title:source.title,value:source.url)
                        if source.url == nil,source.title == nil { Text("Document source").font(.caption) }
                        ForEach(Array(Set(source.relations.compactMap(\.quote))).sorted(),id:\.self) { quote in
                            DisclosureGroup("Quoted text") { Text(quote).font(.caption).textSelection(.enabled) }
                        }
                    }
                }
            }
        }
    }
}
