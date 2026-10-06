import SwiftUI

// A value builder preserves the existing row/gesture hierarchy and state owner.
@ViewBuilder func nativeLiveUserMessageRow(
    row: NativeLiveConversationRowPresentation,
    user: NativeLiveMessagePresentation,
    appModel: AppModel,
    isTurnInFlight: Bool,
    onCopyMessage: @escaping (String) -> Void,
    onEditMessage: @escaping (NativeLiveCurrentPathMessage) -> Void
) -> some View {
    HStack(alignment:.top,spacing:0) {
        Spacer(minLength:ChatPresentationLayout.userLeadingClearance)
        NativeLiveUserMessagePresentationView(presentation:user,isVoiceTranscriptRevealed:Binding(
            get:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion },
            set:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion = $0 }),
            onEdit:row.userBacking.map { message in { onEditMessage(message) } },onCopy:onCopyMessage,isDisabled:isTurnInFlight)
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
                    .padding(.horizontal,ChatPresentationLayout.bubbleHorizontalInset).padding(.vertical,ChatPresentationLayout.bubbleVerticalInset)
                    .background(Color.chatSoftFill,in:RoundedRectangle(cornerRadius:ChatPresentationLayout.bubbleRadius,style:.continuous))
                    .overlay {
                        if let onEdit {
                            LightweightContextMenuInteraction(title:"Edit",copyText:presentation.copyText,isDisabled:isDisabled,
                                cornerRadius:ChatPresentationLayout.bubbleRadius,onCopy:onCopy,onTap:toggleVoice,action:onEdit)
                        }
                    }
                    .onTapGesture { if onEdit == nil { toggleVoice() } }
            }
        }
    }
    @ViewBuilder private var textBubble: some View {
        if presentation.isVoiceInput {
            VStack(alignment:.trailing,spacing:10) {
                NativeLiveVoiceMessageBubbleVisual(isExpanded:isVoiceTranscriptRevealed, transcript:presentation.copyText)
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

private struct NativeLiveVoiceMessageBubbleVisual: View {
    let isExpanded: Bool
    let transcript: String?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(.primary)
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .frame(width: NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript, clusterWidth: NativeLiveVoiceBubbleMetrics.userClusterWidth), alignment: .trailing)
        .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isExpanded ? "Voice message, transcript shown" : "Voice message, tap to show transcript")
    }
}
