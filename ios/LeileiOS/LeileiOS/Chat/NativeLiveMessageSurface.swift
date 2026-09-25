import SwiftUI
import UIKit

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
                        .overlay {
                            LightweightContextMenuInteraction(
                                title: "Edit",
                                systemImage: "pencil",
                                isDisabled: isTurnInFlight,
                                cornerRadius: 18
                            ) {
                                onEditMessage(message)
                            }
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
                        .overlay {
                            if let targetUserMessageID = message.parentMessageId {
                                LightweightContextMenuInteraction(
                                    title: "Retry",
                                    systemImage: "arrow.clockwise",
                                    isDisabled: isTurnInFlight,
                                    cornerRadius: 12
                                ) {
                                    onRetryMessage(targetUserMessageID)
                                }
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

private struct LightweightContextMenuInteraction: UIViewRepresentable {
    let title: String
    let systemImage: String
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            title: title,
            systemImage: systemImage,
            isDisabled: isDisabled,
            cornerRadius: cornerRadius,
            action: action
        )
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isOpaque = false

        let interaction = UIContextMenuInteraction(
            delegate: context.coordinator
        )
        view.addInteraction(interaction)
        context.coordinator.hostView = view
        return view
    }

    func updateUIView(
        _ uiView: UIView,
        context: Context
    ) {
        context.coordinator.title = title
        context.coordinator.systemImage = systemImage
        context.coordinator.isDisabled = isDisabled
        context.coordinator.cornerRadius = cornerRadius
        context.coordinator.action = action
        context.coordinator.hostView = uiView
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        weak var hostView: UIView?

        var title: String
        var systemImage: String
        var isDisabled: Bool
        var cornerRadius: CGFloat
        var action: () -> Void

        init(
            title: String,
            systemImage: String,
            isDisabled: Bool,
            cornerRadius: CGFloat,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.systemImage = systemImage
            self.isDisabled = isDisabled
            self.cornerRadius = cornerRadius
            self.action = action
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint
        ) -> UIContextMenuConfiguration? {
            UIContextMenuConfiguration(
                identifier: nil,
                previewProvider: nil
            ) { [weak self] _ in
                guard let self else {
                    return UIMenu(children: [])
                }

                let attributes: UIMenuElement.Attributes =
                    self.isDisabled ? [.disabled] : []

                let action = UIAction(
                    title: self.title,
                    image: UIImage(systemName: self.systemImage),
                    attributes: attributes
                ) { [weak self] _ in
                    self?.action()
                }

                return UIMenu(children: [action])
            }
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configuration: UIContextMenuConfiguration,
            highlightPreviewForItemWithIdentifier identifier: any NSCopying
        ) -> UITargetedPreview? {
            preview(for: interaction)
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configuration: UIContextMenuConfiguration,
            dismissalPreviewForItemWithIdentifier identifier: any NSCopying
        ) -> UITargetedPreview? {
            preview(for: interaction)
        }

        private func preview(
            for interaction: UIContextMenuInteraction
        ) -> UITargetedPreview? {
            guard let hostView = interaction.view else {
                return nil
            }

            let previewView = hostView.superview ?? hostView
            let parameters = UIPreviewParameters()
            parameters.backgroundColor = .clear
            parameters.visiblePath = UIBezierPath(
                roundedRect: previewView.bounds,
                cornerRadius: cornerRadius
            )
            parameters.shadowPath = UIBezierPath()

            return UITargetedPreview(
                view: previewView,
                parameters: parameters
            )
        }
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
