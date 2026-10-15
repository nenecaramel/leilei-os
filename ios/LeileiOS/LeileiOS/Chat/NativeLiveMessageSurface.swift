import SwiftUI
import QuickLook
import CryptoKit
import UIKit

struct NativeLiveMessageSurface: View {
    let snapshot: NativeLiveCurrentPathSnapshot?
    let historySnapshot: NativeLiveConversationHistorySnapshot?
    let syncState: AppModel.ChatSyncState
    let isAuthenticated: Bool
    let hasActiveConversation: Bool
    let isTurnInFlight: Bool
    let pendingOperation: NativeLivePendingOperation?
    let runtimeSurface: NativeLiveRuntimeSurfaceState?
    let onResolveRuntimeInteraction:
        (
            NativeLiveRuntimeInteractionSnapshot,
            [String: NativeLiveJSONValue]
        ) async throws -> Void
    let onRefresh: () async -> Void
    let onLoadOlder: () async -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    @EnvironmentObject private var appModel: AppModel
    @Environment(\.chatTheme) private var chatTheme
    private let bottomAnchorID = "native-live-chat-bottom"
    @State private var scrollState = NativeLiveConversationScrollState()
    @State private var scrollPosition = ScrollPosition()
    @State private var rowFrames: [String:CGRect] = [:]
    @State private var anchorReplacementID: String?
    @State private var preservedAnchor: NativeLiveConversationScrollState.Anchor?
    @State private var contentOffset: Double = 0
    @State private var copiedMessageID: String?
    @State private var copyFeedbackText: String?
    @State private var copyFeedbackToken = UUID()
    @State private var isLoadingOlderMessages = false

    var body: some View {
        Group {
            if !isAuthenticated {
                Self.scrollableState { AppStateSurface(title: "Sign in") }
            } else if pendingOperation != nil {
                messageList(snapshot)
            } else if !hasActiveConversation {
                Self.scrollableState { AppStateSurface(title: "Nothing here") }
            } else {
                switch NativeLiveConversationLoadPresentation.project(
                    hasSnapshot:snapshot != nil || historySnapshot != nil,
                    hasRows:appModel.nativeLiveConversationRows.contains { !$0.isHistoryDivider },
                    ready:syncState == .ready,failed:syncUnavailable) {
                case .content: messageList(snapshot)
                case .quietLoading: Self.scrollableState { Color.clear }
                case .empty: Self.scrollableState { AppStateSurface(title:"Nothing here") }
                case .unavailable:
                    Self.scrollableState {
                        AppStateSurface(title:"Unavailable",actionTitle:"Retry") { Task { await onRefresh() } }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // The iMessage wallpaper is owned by ChatView behind this scroll
        // surface; Original retains its opaque system background.
        .background(chatTheme == .iMessage ? Color.clear : Color(.systemBackground))
        .environment(\.nativeLiveCopyFeedback) { text in
            showCopyFeedback(text)
        }
    }

    private var syncUnavailable: Bool {
        if case .unavailable = syncState { return true }
        return false
    }

    static func scrollableState<Content: View>(
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        GeometryReader { geometry in
            ScrollView {
                content()
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.always)
        }
    }

    private func messageList(
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> some View {
        let rows = appModel.nativeLiveConversationRows
        return ScrollViewReader { proxy in
            ScrollView {
                nativeLiveMessageList(
                    rows: rows,
                    currentHeadMessageID: snapshot?.currentHeadMessageId,
                    isTurnInFlight: isTurnInFlight,
                    copiedMessageID: copiedMessageID,
                    bottomAnchorID: bottomAnchorID,
                    onCopyMessage: { copyMessage($0, messageID: $1) },
                    onRetryMessage: onRetryMessage,
                    onEditMessage: onEditMessage,
                    onResolveRuntimeInteraction: onResolveRuntimeInteraction,
                    rowSpacing: chatTheme == .iMessage ? ChatPresentationLayout.iMessageTurnSpacing : ChatPresentationLayout.turnSpacing,
                    pagination: { loadOlderButton(snapshot) }
                )
            }
            // Scroll observation and lifecycle: order and owner intentionally unchanged.
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.always)
            // iMessage's composer is a translucent separate safe-area inset.
            // Do not let oversized transcript content paint underneath it.
            // Original preserves its existing unclipped scrolling surface.
            .scrollClipDisabled(chatTheme != .iMessage)
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .refreshable {
                guard !isTurnInFlight else { return }
                await onRefresh()
            }
            .coordinateSpace(name:"native-live-viewport")
            .scrollPosition($scrollPosition)
            .onPreferenceChange(NativeLiveRowFramesKey.self) { frames in
                if let operation = pendingOperation, !operation.isSend { captureReplacementAnchor(operation) }
                rowFrames = frames
                preservedAnchor = scrollState.preservedAnchor(before:preservedAnchor,survivingIDs:Set(rows.map(\.id)),replacementID:anchorReplacementID)
                if let anchor = preservedAnchor, let frame = frames[anchor.stableID] {
                    preservedAnchor = nil; anchorReplacementID = nil
                    scrollPosition.scrollTo(y:max(0,contentOffset + frame.minY - anchor.relativeOffset))
                }
            }
            .onScrollGeometryChange(for:NativeLiveScrollMetrics.self) { geometry in
                .init(nearBottom:geometry.visibleRect.maxY >= geometry.contentSize.height-12,
                    offset:geometry.contentOffset.y,height:geometry.contentSize.height)
            } action: { old, metrics in
                contentOffset = metrics.offset
                scrollState.geometryChanged(isNearBottom:metrics.nearBottom)
                if old.height != metrics.height && scrollState.shouldFollowContent && preservedAnchor == nil { scrollToBottom(proxy) }
            }
            .onScrollPhaseChange { _, phase in
                let interacting = phase == .tracking || phase == .interacting || phase == .decelerating
                if interacting { preservedAnchor = nil; anchorReplacementID = nil }
                scrollState.interactionChanged(interacting)
            }
            .onChange(of:snapshot?.conversationId) { old, new in
                guard old != new, pendingOperation?.isSend != true else { return }
                scrollState = .init(); preservedAnchor = nil
            }
            .onChange(of:pendingOperation?.id) { _, _ in
                if pendingOperation?.isSend == true { scrollState.sentNewMessage(); scrollToBottom(proxy) }
                else if let operation = pendingOperation { captureReplacementAnchor(operation) }
            }
            // Surface overlays: visibility and actions remain owned here.
            .overlay(alignment: .top) {
                if let copyFeedbackText {
                    NativeLiveCopyFeedbackBanner(text: copyFeedbackText)
                    .transition(
                        .move(edge: .top)
                            .combined(with: .opacity)
                    )
                }
            }
            .overlay(alignment: .bottom) {
                if scrollState.shouldShowReturnToBottom {
                    Button {
                        scrollState.returnToBottom()
                        withAnimation(.snappy) {
                            proxy.scrollTo(
                                bottomAnchorID,
                                anchor: .bottom
                            )
                        }
                    } label: {
                        NativeLiveReturnToBottomGlyph()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Scroll to latest")
                    // Pin inside the visible transcript above the composer.
                    // The old +22pt paint offset pushed the button into the
                    // iMessage input when the keyboard shortened the viewport.
                    // Original retains the previous visual position.
                    .padding(.bottom, chatTheme == .iMessage ? 12 : 0)
                    .offset(y: chatTheme == .iMessage ? 0 : ChatPresentationLayout.scrollActionPaintOffset)
                    .transition(
                        .scale(scale: 0.9)
                            .combined(with: .opacity)
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func loadOlderButton(
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> some View {
        if snapshot?.olderCursor != nil {
            Button {
                guard !isLoadingOlderMessages,
                      !isTurnInFlight else {
                    return
                }

                captureAnchor()
                isLoadingOlderMessages = true
                Task {
                    await onLoadOlder()
                    await MainActor.run {
                        isLoadingOlderMessages = false
                    }
                }
            } label: {
                NativeLivePaginationLabel(isLoadingOlderMessages: isLoadingOlderMessages)
            }
            .buttonStyle(.plain)
            .disabled(
                isLoadingOlderMessages
                    || isTurnInFlight
            )
            .id("native-live-load-older")
        }
    }

    private func captureReplacementAnchor(_ operation: NativeLivePendingOperation) {
        guard scrollState.beginReplacement(operation.id) else { return }
        captureAnchor()
        anchorReplacementID = appModel.nativeLivePresentationAssembler.pendingIDs(operation,snapshot:snapshot,identities:appModel.nativeLiveTurnIdentities).assistant
    }

    private func captureAnchor() {
        guard !scrollState.followLatest,
              let first = rowFrames.filter({ $0.value.maxY > 0 }).min(by:{ $0.value.minY < $1.value.minY }) else { return }
        preservedAnchor = .init(stableID:first.key,relativeOffset:first.value.minY)
    }

    private func copyMessage(
        _ text: String,
        messageID: String
    ) {
        UIPasteboard.general.string = text
        showCopyFeedback(
            "Message copied",
            messageID: messageID
        )
    }

    private func showCopyFeedback(
        _ text: String,
        messageID: String? = nil
    ) {
        let token = UUID()
        copyFeedbackToken = token

        withAnimation(.easeInOut(duration: 0.16)) {
            copyFeedbackText = text
            copiedMessageID = messageID
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard copyFeedbackToken == token else { return }

            withAnimation(.easeInOut(duration: 0.16)) {
                copyFeedbackText = nil
                copiedMessageID = nil
            }
        }
    }

    private func scrollToBottom(
        _ proxy: ScrollViewProxy
    ) {
        Task { @MainActor in
            await Task.yield()
            guard scrollState.shouldFollowContent else { return }
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }
}

private struct NativeLiveScrollMetrics: Equatable { let nearBottom: Bool; let offset: Double; let height: Double }
