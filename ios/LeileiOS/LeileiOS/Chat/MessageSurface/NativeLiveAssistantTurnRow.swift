import SwiftUI

// The row draws a single pre-reconciled turn. It never chooses runtime/canonical owners.
struct NativeLiveAssistantTurnRow: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.chatTheme) private var chatTheme
    let turn: NativeLiveAssistantTurnPresentation
    let isCurrentHead: Bool
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
    let onRetryMessage: (String) -> Void
    let onResolveInteraction: (NativeLiveRuntimeInteractionSnapshot,[String:NativeLiveJSONValue]) async throws -> Void
    var body: some View { content }

    private var retryAction: (() -> Void)? {
        guard turn.canRetry, let userID = turn.parentUserMessageID else { return nil }
        return { onRetryMessage(userID) }
    }

    private var content: some View {
        VStack(alignment:.leading,spacing:ChatPresentationLayout.assistantSpacing) {
            if processSections.showsLoading {
                if chatTheme == .iMessage {
                    // A waiting state is a status, not a tappable detail row.
                    // Follow the existing Thought process / Worked for paint.
                    NativeLiveProcessStatusHeadline(
                        title: turn.header.isEmpty ? "Thinking…" : turn.header
                    )
                } else {
                    Text("Thinking...").font(.system(size: 14)).foregroundStyle(.secondary).padding(.leading, 2)
                }
            }
            NativeLiveVisibleThinkingSurface(items: turn.visibleThinking, murmurText: turn.murmurText)
                .padding(.bottom, processSections.showsThinking && (processSections.showsActivity || !turn.bodyPresentation.nodes.isEmpty) ? processSectionExtraSpacing : 0)
            activityArea
                .padding(.bottom, processSections.showsActivity && !turn.bodyPresentation.nodes.isEmpty ? processSectionExtraSpacing : 0)
            spotifyResultArea
            elevenLabsResultArea
            if chatTheme == .iMessage {
                NativeLiveIMessageTextBubbleList(
                    presentation: turn.bodyPresentation,
                    side: .incoming,
                    timestamp: turn.visibleTimestamp.map { MessageTimestampFormatter.string(from: $0) },
                    onCopy: onCopyMessage,
                    onRetry: retryAction,
                    isRetryDisabled: isTurnInFlight
                )
                .textSelection(.enabled)
            } else {
                NativeLiveMessagePresentationView(presentation:turn.bodyPresentation).textSelection(.enabled)
            }
            MindWriteIndicator(items:mindWrites)
            if chatTheme == .original {
                nativeLiveAssistantActions(turn:turn,isTurnInFlight:isTurnInFlight,isCopied:isCopied,
                    onCopyMessage:onCopyMessage,onRetryMessage:onRetryMessage)
            }
        }
        .frame(maxWidth:.infinity,alignment:.leading)
        .task(id:turn.canonicalMessageID) {
            guard let id = turn.canonicalMessageID else { return }
            await appModel.refreshMindWrites(messageID:id)
        }
    }
    // iMessage targets 10pt between Thought/Worked, Worked/body, or
    // Thought/body: the 6pt VStack gap plus 4pt conditional inset.
    // Original retains the existing 18pt process gap and footer behavior.
    private var processSectionExtraSpacing: CGFloat {
        (chatTheme == .iMessage ? ChatPresentationLayout.iMessageProcessSectionSpacing : ChatPresentationLayout.processSectionSpacing) - ChatPresentationLayout.assistantSpacing
    }
    private var processSections: NativeLiveProcessSections {
        NativeLiveProcessSections(isActive: turn.activityProjection.turnIsActive,
            hasBody: !turn.bodyPresentation.nodes.isEmpty,
            hasThinking: !turn.visibleThinking.isEmpty, stepCount: turn.stepCount,
            needsInput: turn.hasPendingInput, hasFailure: turn.activityProjection.hasFailure,
            hasBackgroundTask: turn.activityProjection.hasActiveBackgroundTask)
    }
    @ViewBuilder private var activityArea: some View {
        if processSections.showsActivity || activityMurmurText != nil {
            NativeLiveTurnActivityView(projection:turn.activityProjection,
                header:activityHeader, murmurText:activityMurmurText,
                expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 }),
                onResolveInteraction:onResolveInteraction)
        }
    }
    // The murmur bubble trails the first process row: Thought process when
    // shown, otherwise Worked for, otherwise a row of its own before the body.
    private var activityMurmurText: String? { turn.visibleThinking.isEmpty ? turn.murmurText : nil }
    private var activityHeader: String {
        // Preserve existing timing/count and pending-input/background labels.
        if turn.stepCount > 0 || turn.hasPendingInput || turn.backgroundState { return turn.header }
        if turn.activityProjection.hasFailure { return "Failed" }
        return ""
    }
    @ViewBuilder private var spotifyResultArea: some View {
        let items = NativeLiveSpotifyResultSurfaceProjector.project(tools: turn.activityProjection.tools)
        if !items.isEmpty {
            NativeLiveSpotifyResultSurface(items: items)
        }
    }
    @ViewBuilder private var elevenLabsResultArea: some View {
        let items = NativeLiveElevenLabsResultProjector.project(tools: turn.activityProjection.tools)
        if !items.isEmpty {
            NativeLiveElevenLabsResultSurface(items: items)
        }
    }
    private var mindWrites: [MindWriteIndicatorItem] {
        guard let id = turn.canonicalMessageID, let value = appModel.mindWritesByMessageID[id] else { return [] }
        return value.kinds.map { .init(kind:$0.kind.displayName,count:$0.count) }
    }
}
