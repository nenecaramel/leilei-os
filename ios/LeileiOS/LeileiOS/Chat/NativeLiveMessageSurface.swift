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
    private let bottomAnchorID = "native-live-chat-bottom"
    @State private var scrollState = NativeLiveConversationScrollState()
    @State private var scrollPosition = ScrollPosition()
    @State private var rowFrames: [String:CGRect] = [:]
    @State private var preservedAnchor: NativeLiveConversationScrollState.Anchor?
    @State private var contentOffset: Double = 0
    @State private var copiedMessageID: String?
    @State private var copyFeedbackToken = UUID()
    @State private var isLoadingOlderMessages = false

    var body: some View {
        Group {
            if !isAuthenticated {
                AppStateSurface(title: "Sign in")
            } else if pendingOperation != nil {
                messageList(snapshot)
            } else if !hasActiveConversation {
                AppStateSurface(title: "Nothing here")
            } else {
                switch NativeLiveConversationLoadPresentation.project(
                    hasSnapshot:snapshot != nil || historySnapshot != nil,
                    hasRows:!appModel.nativeLiveConversationRows.isEmpty,
                    ready:syncState == .ready,failed:syncUnavailable) {
                case .content: messageList(snapshot)
                case .quietLoading: Color.clear
                case .empty: AppStateSurface(title:"Nothing here")
                case .unavailable:
                    AppStateSurface(title:"Unavailable",actionTitle:"Retry") { Task { await onRefresh() } }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private var syncUnavailable: Bool {
        if case .unavailable = syncState { return true }
        return false
    }

    private func messageList(
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> some View {
        let rows = appModel.nativeLiveConversationRows
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 21) {
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
                            HStack(spacing: 8) {
                                if isLoadingOlderMessages {
                                    ProgressView()
                                        .controlSize(.small)
                                } else {
                                    Image(systemName: "chevron.up")
                                        .font(.system(size: 12, weight: .semibold))
                                }

                                Text(
                                    isLoadingOlderMessages
                                        ? "正在加载…"
                                        : "还有更早消息"
                                )
                                .font(.footnote.weight(.medium))
                            }
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                        .disabled(
                            isLoadingOlderMessages
                                || isTurnInFlight
                        )
                        .id("native-live-load-older")
                    }

                    ForEach(rows) { row in
                        NativeLiveMessageRow(row:row,
                            isCurrentHead:row.assistant?.canonicalMessageID == snapshot?.currentHeadMessageId,
                            isTurnInFlight:isTurnInFlight,isCopied:copiedMessageID == row.id,
                            onCopyMessage:{ copyMessage($0,messageID:row.id) },onRetryMessage:onRetryMessage,
                            onEditMessage:onEditMessage,onResolveInteraction:onResolveRuntimeInteraction)
                            .id(row.id)
                            .background(GeometryReader { geometry in
                                Color.clear.preference(key:NativeLiveRowFramesKey.self,
                                    value:[row.id:geometry.frame(in:.named("native-live-viewport"))])
                            })
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchorID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .scrollClipDisabled()
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .refreshable {
                guard !isTurnInFlight else { return }
                await onRefresh()
            }
            .coordinateSpace(name:"native-live-viewport")
            .scrollPosition($scrollPosition)
            .onPreferenceChange(NativeLiveRowFramesKey.self) { frames in
                rowFrames = frames
                preservedAnchor = scrollState.preservedAnchor(before:preservedAnchor,survivingIDs:Set(rows.map(\.id)))
                if let anchor = preservedAnchor, let frame = frames[anchor.stableID] {
                    preservedAnchor = nil
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
                scrollState.interactionChanged(phase == .tracking || phase == .interacting || phase == .decelerating)
            }
            .onChange(of:snapshot?.conversationId) { old, new in
                guard old != new, pendingOperation?.isSend != true else { return }
                scrollState = .init(); preservedAnchor = nil
            }
            .onChange(of:pendingOperation?.id) { _, _ in
                if pendingOperation?.isSend == true { scrollState.sentNewMessage(); scrollToBottom(proxy) }
                else if pendingOperation != nil { captureAnchor() }
            }
            .overlay(alignment: .top) {
                if copiedMessageID != nil {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark")
                            .font(.system(
                                size: 12,
                                weight: .semibold
                            ))

                        Text("Message copied")
                            .font(.system(
                                size: 14,
                                weight: .regular
                            ))

                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 14)
                    .frame(
                        maxWidth: .infinity,
                        minHeight: 40
                    )
                    .glassEffect(
                        .regular,
                        in: RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                    )
                    .overlay {
                        RoundedRectangle(
                            cornerRadius: 14,
                            style: .continuous
                        )
                        .stroke(
                            Color.primary.opacity(0.08),
                            lineWidth: 0.6
                        )
                    }
                    .padding(.horizontal, 18)
                    .padding(.top, 10)
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
                        Image(systemName: "arrow.down")
                            .font(.system(
                                size: 16,
                                weight: .light
                            ))
                            .foregroundStyle(
                                Color.primary.opacity(0.78)
                            )
                            .frame(width: 38, height: 38)
                            .glassEffect(
                                .regular,
                                in: Circle()
                            )
                            .overlay {
                                Circle()
                                    .stroke(
                                        Color.primary.opacity(0.08),
                                        lineWidth: 0.6
                                    )
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Scroll to latest")
                    .offset(y: 22)
                    .transition(
                        .scale(scale: 0.9)
                            .combined(with: .opacity)
                    )
                }
            }
        }
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

        let token = UUID()
        copyFeedbackToken = token

        withAnimation(.easeInOut(duration: 0.16)) {
            copiedMessageID = messageID
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard copyFeedbackToken == token else { return }

            withAnimation(.easeInOut(duration: 0.16)) {
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

private struct NativeLiveRowFramesKey: PreferenceKey {
    static var defaultValue: [String:CGRect] { [:] }
    static func reduce(value:inout [String:CGRect],nextValue:()->[String:CGRect]) { value.merge(nextValue()) { _,fresh in fresh } }
}
private struct NativeLiveScrollMetrics: Equatable { let nearBottom: Bool; let offset: Double; let height: Double }
