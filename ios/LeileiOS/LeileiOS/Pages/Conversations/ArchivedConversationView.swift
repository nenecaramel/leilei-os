import SwiftUI
import UIKit

struct ArchivedConversationView: View {
    @EnvironmentObject private var appModel: AppModel

    let conversationID: UUID
    let title: String?

    @State private var snapshot: NativeLiveCurrentPathSnapshot?
    @State private var rows: [NativeLiveConversationRowPresentation] = []
    @State private var loading = true
    @State private var loadingOlder = false
    @State private var errorMessage: String?
    @State private var copiedMessageID: String?

    private let bottomAnchorID =
        "archived-native-live-chat-bottom"

    var body: some View {
        Group {
            if loading && snapshot == nil {
                ProgressView()
                    .controlSize(.small)
                    .frame(
                        maxWidth: .infinity,
                        maxHeight: .infinity
                    )
            } else if let errorMessage,
                      snapshot == nil {
                AppStateSurface(
                    title: errorMessage,
                    actionTitle: "Retry"
                ) {
                    Task {
                        await loadInitial()
                    }
                }
            } else if let snapshot {
                ScrollView {
                    nativeLiveMessageList(
                        rows: rows,
                        currentHeadMessageID:
                            snapshot.currentHeadMessageId,
                        isTurnInFlight: true,
                        copiedMessageID: copiedMessageID,
                        bottomAnchorID: bottomAnchorID,
                        onCopyMessage: { text, messageID in
                            UIPasteboard.general.string = text
                            copiedMessageID = messageID
                        },
                        onRetryMessage: { _ in },
                        onEditMessage: { _ in },
                        onResolveRuntimeInteraction: nil,
                        pagination: {
                            olderMessagesButton(snapshot)
                        }
                    )
                }
                .coordinateSpace(name: "native-live-viewport")
                .refreshable {
                    await loadInitial()
                }
            } else {
                AppStateSurface(title: "Nothing here")
            }
        }
        .frame(
            maxWidth: .infinity,
            maxHeight: .infinity
        )
        .background(Color(.systemBackground))
        .navigationTitle(displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: conversationID) {
            await loadInitial()
        }
    }

    @ViewBuilder
    private func olderMessagesButton(
        _ snapshot: NativeLiveCurrentPathSnapshot
    ) -> some View {
        if snapshot.olderCursor != nil {
            Button {
                Task {
                    await loadOlder()
                }
            } label: {
                NativeLivePaginationLabel(
                    isLoadingOlderMessages: loadingOlder
                )
            }
            .buttonStyle(.plain)
            .disabled(loadingOlder)
            .id("archived-native-live-load-older")
        }
    }

    @MainActor
    private func loadInitial() async {
        guard !loadingOlder else { return }

        loading = true
        errorMessage = nil
        defer {
            loading = false
        }

        do {
            let result =
                try await appModel.api.nativeLiveCurrentPath(
                    conversationID: conversationID,
                    limit: 200
                )
            guard case .modified(let loaded, _) = result else {
                return
            }
            snapshot = loaded
            rebuildRows()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadOlder() async {
        guard !loadingOlder,
              let current = snapshot,
              let olderCursor = current.olderCursor else {
            return
        }

        loadingOlder = true
        defer {
            loadingOlder = false
        }

        do {
            let result =
                try await appModel.api.nativeLiveCurrentPath(
                    conversationID: conversationID,
                    limit: 200,
                    beforeMessageID: olderCursor
                )
            guard case .modified(let page, _) = result else {
                return
            }

            if page.resetRequired {
                snapshot = page
                rebuildRows()
                return
            }

            let known = Set(current.messages.map(\.id))
            let older = page.messages.filter {
                !known.contains($0.id)
            }
            snapshot = NativeLiveCurrentPathSnapshot(
                conversationId: current.conversationId,
                title: current.title,
                currentHeadMessageId:
                    current.currentHeadMessageId,
                updatedAt: current.updatedAt,
                syncToken: current.syncToken,
                truncated: page.truncated,
                olderCursor: page.olderCursor,
                resetRequired: false,
                messages: older + current.messages,
                failedTurn: current.failedTurn
            )
            rebuildRows()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func rebuildRows() {
        var assembler =
            NativeLiveConversationPresentationAssembler()
        rows = assembler.project(
            snapshot: snapshot,
            pendingOperation: nil,
            runtimeSurface: nil,
            backgroundRuntimeSurfaces: [:],
            identities: NativeLiveTurnIdentityCoordinator(),
            now: Date()
        )
    }

    private var displayTitle: String {
        let normalized = title?
            .trimmingCharacters(
                in: .whitespacesAndNewlines
            )
        return normalized?.isEmpty == false
            ? normalized!
            : "Archived Conversation"
    }
}
