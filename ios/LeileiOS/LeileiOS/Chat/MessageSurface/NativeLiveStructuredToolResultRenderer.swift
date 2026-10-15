import SwiftUI

struct NativeLiveStructuredToolResultView: View {
    let node: NativeLiveVisualNode
    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            Text("Shared result").font(.subheadline.weight(.medium))
            if node.structuredStatus?.truncated == true { Label("Result is incomplete",systemImage:"text.badge.minus").font(.caption) }
            if node.structuredStatus?.redacted == true { Text("Some result data was omitted").font(.caption).foregroundStyle(.secondary) }
            if let diagnostic=node.structuredStatus?.diagnostic { Text(diagnostic).font(.caption).foregroundStyle(.secondary) }
            ForEach(node.children) { child in
                // Erase recursive composition; every child still dispatches through the shared registry.
                AnyView(NativeLiveVisualNodeView(node:child,role:"assistant"))
            }
        }.padding(12)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0.035,
            originalCornerRadius: 12
        ))
    }
}
struct NativeLiveStructuredJSONView: View {
    @Environment(\.iMessageWallpaperVisible) private var iMessageWallpaperVisible
    let json: NativeLiveStructuredJSON
    @State private var expanded=false
    var body: some View {
        VStack(alignment:.leading,spacing:6) {
            DisclosureGroup("JSON value",isExpanded:$expanded) { tree(json.value) }
            if json.truncated { Text("Value is incomplete").font(.caption).foregroundStyle(.secondary) }
            Button("Copy JSON") { UIPasteboard.general.string=json.copyJSON }.font(.caption)
        }
        .padding(iMessageWallpaperVisible ? 12 : 0)
        .modifier(NativeLiveIMessageContentPanel(
            originalOpacity: 0,
            originalCornerRadius: 11
        ))
    }
    private func tree(_ value:NativeLiveJSONValue) -> AnyView {
        switch value {
        case .object(let object):
            return AnyView(VStack(alignment:.leading,spacing:6) {
                ForEach(object.keys.sorted(),id:\.self) { key in
                    DisclosureGroup(key) { tree(object[key]!) }
                        .contextMenu { Button("Copy value") { UIPasteboard.general.string=NativeLiveStructuredJSON(object[key]!).copyJSON } }
                }
                if object.isEmpty { Text("{}") }
            }.padding(.leading,8))
        case .array(let array):
            return AnyView(VStack(alignment:.leading,spacing:6) {
                ForEach(array.indices,id:\.self) { index in
                    DisclosureGroup("[\(index)]") { tree(array[index]) }
                        .contextMenu { Button("Copy value") { UIPasteboard.general.string=NativeLiveStructuredJSON(array[index]).copyJSON } }
                }
                if array.isEmpty { Text("[]") }
            }.padding(.leading,8))
        default:
            return AnyView(Text(NativeLiveStructuredJSON(value).copyJSON).font(.system(.caption,design:.monospaced))
                .textSelection(.enabled).contextMenu { Button("Copy value") { UIPasteboard.general.string=NativeLiveStructuredJSON(value).copyJSON } })
        }
    }
}
