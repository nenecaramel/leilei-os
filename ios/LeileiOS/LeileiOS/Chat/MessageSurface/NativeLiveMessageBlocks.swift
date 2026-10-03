import SwiftUI
import Foundation

struct NativeLiveMessagePresentationView: View {
    let presentation: NativeLiveMessagePresentation

    var body: some View {
        NativeLiveVisualNodesView(nodes: presentation.nodes, role: presentation.role)
    }
}

struct NativeLiveUserMessagePresentationView: View {
    let presentation: NativeLiveMessagePresentation
    @Binding var isVoiceTranscriptRevealed: Bool

    @ViewBuilder var body: some View {
        if presentation.isVoiceInput {
            VStack(alignment: .leading, spacing: 10) {
                NativeLiveVoiceMessageBubbleVisual(isExpanded: isVoiceTranscriptRevealed)
                if isVoiceTranscriptRevealed {
                    NativeLiveMessagePresentationView(presentation: presentation)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    NativeLiveVisualNodesView(nodes: presentation.collapsedVoiceNodes, role: presentation.role)
                }
            }
        } else {
            NativeLiveMessagePresentationView(presentation: presentation)
        }
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
            NativeLiveAttachmentBlockView(block: attachmentRendererBlock)
        case .fallback:
            NativeLiveVisualFallbackView(fallback: node.fallback)
        }
    }

    private var attachmentRendererBlock: NativeLiveCurrentPathBlock {
        var payload = node.sourceBlock.payload ?? [:]
        if let attachment = node.attachment {
            // Preserve canonical integrity/size metadata while supporting ref-only inputs.
            payload.merge(attachment.blockPayload) { original, _ in original }
        }
        return .init(id: node.id, ordinal: node.ordinal, kind: "attachment", rawType: node.rawType,
                     text: nil, payload: payload, createdAt: node.sourceBlock.createdAt)
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
