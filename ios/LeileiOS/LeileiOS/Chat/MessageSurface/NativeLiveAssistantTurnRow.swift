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
    @ViewBuilder var body: some View {
        if chatTheme == .iMessage {
            content.contextMenu {
                if let text = turn.copyText {
                    Button("Copy") { onCopyMessage(text) }
                }
                if turn.canRetry, let user = turn.parentUserMessageID {
                    Button("Retry") { onRetryMessage(user) }
                        .disabled(isTurnInFlight)
                }
            }
        } else {
            content
        }
    }

    private var content: some View {
        VStack(alignment:.leading,spacing:ChatPresentationLayout.assistantSpacing) {
            if processSections.showsLoading {
                Text("Thinking...").font(.system(size: 14)).foregroundStyle(.secondary)
            }
            NativeLiveVisibleThinkingSurface(items: turn.visibleThinking)
                .padding(.bottom, processSections.showsThinking && (processSections.showsActivity || !turn.bodyPresentation.nodes.isEmpty) ? processSectionExtraSpacing : 0)
            activityArea
                .padding(.bottom, processSections.showsActivity && !turn.bodyPresentation.nodes.isEmpty ? processSectionExtraSpacing : 0)
            spotifyResultArea
            elevenLabsResultArea
            if chatTheme == .iMessage {
                NativeLiveIMessageTextBubbleList(presentation:turn.bodyPresentation,side:.incoming)
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
    // Add only the difference to the existing row spacing. Footer and body
    // spacing stay unchanged; absent sections add no extra inset.
    private var processSectionExtraSpacing: CGFloat {
        ChatPresentationLayout.processSectionSpacing - ChatPresentationLayout.assistantSpacing
    }
    private var processSections: NativeLiveProcessSections {
        NativeLiveProcessSections(isActive: turn.activityProjection.turnIsActive,
            hasBody: !turn.bodyPresentation.nodes.isEmpty,
            hasThinking: !turn.visibleThinking.isEmpty, stepCount: turn.stepCount,
            needsInput: turn.hasPendingInput, hasFailure: turn.activityProjection.hasFailure,
            hasBackgroundTask: turn.activityProjection.hasActiveBackgroundTask)
    }
    @ViewBuilder private var activityArea: some View {
        if processSections.showsActivity || turn.murmurText != nil {
            NativeLiveTurnActivityView(projection:turn.activityProjection,
                header:activityHeader, murmurText:turn.murmurText,
                expansion:Binding(get:{ appModel.nativeLiveMessageUIState[turn.id] },set:{ appModel.nativeLiveMessageUIState[turn.id] = $0 }),
                onResolveInteraction:onResolveInteraction)
        }
    }
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
