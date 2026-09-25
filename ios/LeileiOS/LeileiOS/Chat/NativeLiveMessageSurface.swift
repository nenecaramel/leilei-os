import SwiftUI

struct NativeLiveMessageSurface: View {
    let snapshot: NativeLiveCurrentPathSnapshot?
    let syncState: AppModel.ChatSyncState
    let isAuthenticated: Bool
    let hasActiveConversation: Bool
    let isTurnInFlight: Bool
    let onRefresh: () async -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    private let bottomAnchorID = "native-live-chat-bottom"

    var body: some View {
        Group {
            if !isAuthenticated {
                AppStateSurface(title: "Sign in")
            } else if !hasActiveConversation {
                AppStateSurface(title: "Nothing here")
            } else if let snapshot {
                if snapshot.messages.isEmpty {
                    AppStateSurface(title: "Nothing here")
                } else {
                    messageList(snapshot)
                }
            } else {
                switch syncState {
                case .idle, .loading:
                    AppStateSurface(title: "Loading…")

                case .ready:
                    AppStateSurface(title: "Nothing here")

                case .unavailable:
                    AppStateSurface(
                        title: "Unavailable",
                        actionTitle: "Retry"
                    ) {
                        Task {
                            await onRefresh()
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private func messageList(
        _ snapshot: NativeLiveCurrentPathSnapshot
    ) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 18) {
                    ForEach(snapshot.messages) { message in
                        NativeLiveMessageRow(
                            message: message,
                            isTurnInFlight: isTurnInFlight,
                            onRetryMessage: onRetryMessage,
                            onEditMessage: onEditMessage
                        )
                        .id(message.id)
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchorID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .refreshable {
                await onRefresh()
            }
            .onAppear {
                scrollToBottom(proxy)
            }
            .onChange(of: snapshot.syncToken) { _, _ in
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(
        _ proxy: ScrollViewProxy
    ) {
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }
}

private struct NativeLiveMessageRow: View {
    let message: NativeLiveCurrentPathMessage
    let isTurnInFlight: Bool
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    var body: some View {
        rowContent
    }

    @ViewBuilder
    private var rowContent: some View {
        if message.role == "user" {
            HStack(alignment: .top, spacing: 0) {
                Spacer(minLength: 48)

                VStack(alignment: .trailing, spacing: 6) {
                    messageContent
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            Color.chatSoftFill,
                            in: RoundedRectangle(
                                cornerRadius: 18,
                                style: .continuous
                            )
                        )
                        .contentShape(
                            .contextMenuPreview,
                            RoundedRectangle(
                                cornerRadius: 18,
                                style: .continuous
                            )
                        )
                        .contextMenu {
                            Button("Edit") {
                                onEditMessage(message)
                            }
                            .disabled(isTurnInFlight)
                        }

                    messageStatus
                }
            }
        } else {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(MessageTimestampFormatter.string(
                        from: message.completedAt ?? message.createdAt
                    ))
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    messageContent
                        .contentShape(
                            .contextMenuPreview,
                            RoundedRectangle(
                                cornerRadius: 12,
                                style: .continuous
                            )
                        )
                        .contextMenu {
                            if let targetUserMessageID = message.parentMessageId {
                                Button("Retry") {
                                    onRetryMessage(targetUserMessageID)
                                }
                                .disabled(isTurnInFlight)
                            }
                        }

                    messageStatus
                }

                Spacer(minLength: 24)
            }
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        let blocks = message.blocks.sorted {
            $0.ordinal < $1.ordinal
        }
        let visibleBlocks = blocks.filter {
            normalizedText($0.text) != nil
        }

        if visibleBlocks.isEmpty {
            if message.status == "pending"
                || message.status == "streaming" {
                ProgressView()
                    .controlSize(.small)
                    .frame(minHeight: 20)
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(visibleBlocks) { block in
                    NativeLiveBlockView(
                        block: block,
                        fillsAvailableWidth: message.role != "user"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private var messageStatus: some View {
        if message.status == "error" {
            Text("Failed")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else if message.status == "pending"
                    || message.status == "streaming" {
            Text("Loading…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func normalizedText(_ text: String?) -> String? {
        guard let text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }
}

private struct NativeLiveBlockView: View {
    let block: NativeLiveCurrentPathBlock
    let fillsAvailableWidth: Bool

    var body: some View {
        if let text = normalizedText {
            switch block.kind {
            case "text":
                Text(text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .frame(
                        maxWidth: fillsAvailableWidth ? .infinity : nil,
                        alignment: .leading
                    )

            case "tool_use", "tool_result", "attachment":
                Text(text)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(
                        maxWidth: fillsAvailableWidth ? .infinity : nil,
                        alignment: .leading
                    )

            default:
                EmptyView()
            }
        }
    }

    private var normalizedText: String? {
        guard let text = block.text else { return nil }
        let normalized = text.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return normalized.isEmpty ? nil : normalized
    }
}


private enum MessageTimestampFormatter {
    static func string(from iso8601: String) -> String {
        guard let date = parse(iso8601) else {
            return ""
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: date)
    }

    private static func parse(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [
            .withInternetDateTime,
            .withFractionalSeconds
        ]
        if let date = fractional.date(from: value) {
            return date
        }

        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }
}
