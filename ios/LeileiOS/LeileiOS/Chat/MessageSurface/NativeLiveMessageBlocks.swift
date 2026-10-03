import SwiftUI
import Foundation

struct NativeLiveMessagePresentationView: View {
    let presentation: NativeLiveMessagePresentation

    var body: some View {
        VStack(alignment:.leading,spacing:12) {
            NativeLiveVisualNodesView(nodes: presentation.nodes, role: presentation.role)
            NativeLiveCitationSourcesView(sources:presentation.citationSources)
        }
    }
}

struct NativeLiveUserMessagePresentationView: View {
    let presentation: NativeLiveMessagePresentation
    @Binding var isVoiceTranscriptRevealed: Bool
    var onEdit: (() -> Void)? = nil
    var onCopy: (String) -> Void = { _ in }
    var isDisabled = false

    var body: some View {
        VStack(alignment:.trailing,spacing:10) {
            if !presentation.mediaNodes.isEmpty {
                NativeLiveMediaRenderer(inputs:presentation.attachmentInputs)
                    .contextMenu { if let onEdit { Button("Edit",action:onEdit).disabled(isDisabled) } }
            }
            if !presentation.nonTextBodyNodes.isEmpty {
                NativeLiveVisualNodesView(nodes:presentation.nonTextBodyNodes,role:presentation.role)
            }
            if !presentation.textNodes.isEmpty {
                textBubble
                    .padding(.horizontal,14).padding(.vertical,12)
                    .background(Color.chatSoftFill,in:RoundedRectangle(cornerRadius:18,style:.continuous))
                    .overlay {
                        if let onEdit {
                            LightweightContextMenuInteraction(title:"Edit",copyText:presentation.copyText,isDisabled:isDisabled,
                                cornerRadius:18,onCopy:onCopy,onTap:toggleVoice,action:onEdit)
                        }
                    }
                    .onTapGesture { if onEdit == nil { toggleVoice() } }
            }
        }
    }
    @ViewBuilder private var textBubble: some View {
        if presentation.isVoiceInput {
            VStack(alignment:.leading,spacing:10) {
                NativeLiveVoiceMessageBubbleVisual(isExpanded:isVoiceTranscriptRevealed)
                if isVoiceTranscriptRevealed {
                    NativeLiveVisualNodesView(nodes:presentation.textNodes,role:presentation.role)
                }
            }
        } else { NativeLiveVisualNodesView(nodes:presentation.textNodes,role:presentation.role) }
    }
    private func toggleVoice() {
        guard presentation.isVoiceInput, presentation.copyText != nil else { return }
        withAnimation(.easeInOut(duration:0.16)) { isVoiceTranscriptRevealed.toggle() }
    }
}

private struct NativeLiveVisualNodesView: View {
    let nodes: [NativeLiveVisualNode]
    let role: String

    var body: some View {
        VStack(alignment: .leading, spacing: role == "user" ? 19 : 22) {
            ForEach(nodes) { node in
                NativeLiveVisualNodeView(node: node, role: role)
            }
        }
    }
}

struct NativeLiveVisualNodeView: View {
    let node: NativeLiveVisualNode
    let role: String

    @ViewBuilder var body: some View {
        switch NativeLiveMessageRendererRegistry.renderer(for: node) {
        case .markdown:
            if let text = node.text {
                ChatMarkdownView(text: text, fillsAvailableWidth: role != "user",
                                 lineSpacing: role == "user" ? 5 : 6,
                                 paragraphSpacing: role == "user" ? 19 : 22)
            } else {
                NativeLiveVisualFallbackView(fallback: node.fallback)
            }
        case .attachment:
            if let input = node.attachment { NativeLiveMediaCard(input:input) }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .structuredResult:
            NativeLiveStructuredToolResultView(node:node)
        case .structuredJSON:
            if let json=node.json { NativeLiveStructuredJSONView(json:json) }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .searchResult:
            if let search=node.search { NativeLiveSearchResultView(result:search,sources:node.citationSourcesToRender) }
            else { NativeLiveVisualFallbackView(fallback:node.fallback) }
        case .citation:
            if node.citationSourcesToRender?.isEmpty == true { Text("Source reference").font(.caption).foregroundStyle(.secondary) }
            else { NativeLiveCitationSourcesView(sources:node.citationSourcesToRender ?? NativeLiveCitationSource.aggregate(node.citations)) }
        case .fallback:
            NativeLiveVisualFallbackView(fallback: node.fallback)
        }
    }


}

private struct NativeLiveVisualFallbackView: View {
    let fallback: NativeLiveVisualFallback

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(fallback.title, systemImage: "doc.questionmark")
                .font(.subheadline)
            Text(fallback.rawType).font(.caption)
            Text(fallback.diagnostic).font(.caption)
            ForEach(fallback.metadata.keys.sorted(), id: \.self) { key in
                Text("\(key): \(fallback.metadata[key] ?? "")").font(.caption)
            }
        }
        .foregroundStyle(.secondary)
        .padding(10)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 11))
        .accessibilityElement(children: .combine)
    }
}

private struct NativeLiveVoiceMessageBubbleVisual: View {
    let isExpanded: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(.primary)
            Spacer(minLength: 4)
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .frame(width: 68, alignment: .leading)
        .frame(height: 21, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isExpanded ? "Voice message, transcript shown" : "Voice message, tap to show transcript")
    }
}
