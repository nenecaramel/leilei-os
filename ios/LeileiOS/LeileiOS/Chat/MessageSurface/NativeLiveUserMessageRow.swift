import SwiftUI

// A value builder preserves the existing row/gesture hierarchy and state owner.
@ViewBuilder func nativeLiveUserMessageRow(
    row: NativeLiveConversationRowPresentation,
    user: NativeLiveMessagePresentation,
    appModel: AppModel,
    isTurnInFlight: Bool,
    leadingClearance: CGFloat,
    isIMessage: Bool,
    onCopyMessage: @escaping (String) -> Void,
    onEditMessage: @escaping (NativeLiveCurrentPathMessage) -> Void
) -> some View {
    let messageView = NativeLiveUserMessagePresentationView(presentation:user,isVoiceTranscriptRevealed:Binding(
        get:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion },
        set:{ appModel.nativeLiveMessageUIState[row.id].voiceTranscriptExpansion = $0 }),
        onEdit:row.userBacking.map { message in { onEditMessage(message) } },onCopy:onCopyMessage,isDisabled:isTurnInFlight)
    HStack(alignment:.top,spacing:0) {
        if isIMessage {
            // Both typed text and voice transcripts use the exact same 70pt
            // leading clearance. The row, not a voice-specific width cap,
            // determines how wide either outgoing bubble is allowed to grow.
            Color.clear.frame(width:leadingClearance)
            messageView.frame(maxWidth:.infinity,alignment:.trailing)
        } else {
            // Original message and voice geometry remain unchanged.
            Spacer(minLength:leadingClearance)
            messageView
        }
    }
}

struct NativeLiveUserMessagePresentationView: View {
    @Environment(\.chatTheme) private var chatTheme
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
                userTextBubble
                    .overlay {
                        if let onEdit {
                            LightweightContextMenuInteraction(title:"Edit",copyText:presentation.copyText,isDisabled:isDisabled,
                                cornerRadius:chatTheme == .iMessage ? ChatPresentationLayout.iMessageUserBubbleRadius : ChatPresentationLayout.bubbleRadius,onCopy:onCopy,onTap:toggleVoice,action:onEdit)
                        }
                    }
                    .onTapGesture { if onEdit == nil { toggleVoice() } }
            }
        }
    }
    @ViewBuilder private var userTextBubble: some View {
        if chatTheme == .iMessage {
            if presentation.isVoiceInput {
                iMessageVoiceBubble
            } else {
                NativeLiveIMessageTextBubbleList(presentation: presentation, side: .outgoing)
            }
        } else {
            // Original's compact voice width, inner padding and gray fill
            // remain unchanged; only iMessage adopts its own text bubble.
            textBubble
                .padding(.leading, usesCompactVoiceInsets ? NativeLiveVoiceBubbleGeometry.userLeadingInset : ChatPresentationLayout.bubbleHorizontalInset)
                .padding(.trailing, usesCompactVoiceInsets ? NativeLiveVoiceBubbleGeometry.userTrailingInset : ChatPresentationLayout.bubbleHorizontalInset)
                .padding(.vertical,ChatPresentationLayout.bubbleVerticalInset)
                .background(Color.chatSoftFill,in:RoundedRectangle(cornerRadius:ChatPresentationLayout.bubbleRadius,style:.continuous))
        }
    }

    // Reusing the regular outgoing bubble is intentional: its AppStorage tint,
    // opacity, 14pt/10pt text padding and 20pt rounded material are shared
    // automatically with typed messages. Collapsed, the width grows with the
    // transcript up to the row's 70pt clearance, like a typed message.
    private var iMessageVoiceBubble: some View {
        NativeLiveIMessageTextBubble(side: .outgoing, fitsContent: isVoiceTranscriptRevealed) {
            VStack(alignment: .trailing, spacing: ChatPresentationLayout.iMessageTextBubbleSpacing) {
                HStack(spacing: NativeLiveVoiceBubbleGeometry.userClusterSpacing) {
                    Image(systemName: "waveform")
                        .font(.system(size: 18, weight: .regular))
                    Image(systemName: isVoiceTranscriptRevealed ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(Color.white.opacity(0.98))
                .nativeLiveVoiceBubbleWidth(alignment: .trailing, fallbackMaximum: nil) { maximum in
                    NativeLiveVoiceBubbleGeometry.userWidth(transcript: presentation.copyText,
                        clusterWidth: NativeLiveVoiceBubbleMetrics.userClusterWidth, maxContentWidth: maximum)
                }
                .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    isVoiceTranscriptRevealed
                        ? "Voice message, transcript shown"
                        : "Voice message, tap to show transcript"
                )

                if isVoiceTranscriptRevealed {
                    NativeLiveVisualNodesView(nodes: presentation.textNodes, role: presentation.role)
                        .foregroundStyle(Color.white.opacity(0.98))
                }
            }
        }
    }

    private var usesCompactVoiceInsets: Bool {
        presentation.isVoiceInput && !isVoiceTranscriptRevealed
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
        HStack(spacing: NativeLiveVoiceBubbleGeometry.userClusterSpacing) {
            Image(systemName: "waveform")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(.primary)
            Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        // Up to the row's 48pt clearance, like a typed message.
        .nativeLiveVoiceBubbleWidth(alignment: .trailing, fallbackMaximum: NativeLiveVoiceBubbleGeometry.userMaxContentWidth) { maximum in
            NativeLiveVoiceBubbleGeometry.userWidth(transcript: transcript,
                clusterWidth: NativeLiveVoiceBubbleMetrics.userClusterWidth, maxContentWidth: maximum)
        }
        .frame(height: NativeLiveVoiceBubbleGeometry.contentHeight, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isExpanded ? "Voice message, transcript shown" : "Voice message, tap to show transcript")
    }
}

