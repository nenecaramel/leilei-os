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
    private let scrollCoordinateSpace = "native-live-chat-scroll"

    @State private var isAwayFromBottom = false

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
            GeometryReader { viewport in
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
                            .background {
                                GeometryReader { geometry in
                                    Color.clear.preference(
                                        key: NativeLiveBottomYPreferenceKey.self,
                                        value: geometry.frame(
                                            in: .named(scrollCoordinateSpace)
                                        ).maxY
                                    )
                                }
                            }
                            .id(bottomAnchorID)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                }
                .coordinateSpace(name: scrollCoordinateSpace)
                .refreshable {
                    await onRefresh()
                }
                .onAppear {
                    scrollToBottom(proxy)
                }
                .onChange(of: snapshot.syncToken) { _, _ in
                    scrollToBottom(proxy)
                }
                .onPreferenceChange(
                    NativeLiveBottomYPreferenceKey.self
                ) { bottomY in
                    guard bottomY > 0 else {
                        return
                    }

                    let away = bottomY > viewport.size.height + 56
                    guard away != isAwayFromBottom else { return }

                    withAnimation(.easeInOut(duration: 0.16)) {
                        isAwayFromBottom = away
                    }
                }
                .overlay(alignment: .bottom) {
                    if isAwayFromBottom {
                        Button {
                            withAnimation(.snappy) {
                                proxy.scrollTo(
                                    bottomAnchorID,
                                    anchor: .bottom
                                )
                            }
                        } label: {
                            Image(systemName: "arrow.down")
                                .font(.system(
                                    size: 14,
                                    weight: .semibold
                                ))
                                .foregroundStyle(Color.primary.opacity(0.78))
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
                        .offset(y: 18)
                        .transition(
                            .scale(scale: 0.9)
                                .combined(with: .opacity)
                        )
                    }
                }
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

private struct NativeLiveBottomYPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(
        value: inout CGFloat,
        nextValue: () -> CGFloat
    ) {
        value = nextValue()
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
                                copyText: copyText,
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
                                    copyText: copyText,
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

    private var copyText: String? {
        let text = message.blocks
            .sorted { $0.ordinal < $1.ordinal }
            .compactMap { normalizedText($0.text) }
            .joined(separator: "\n\n")

        return text.isEmpty ? nil : text
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
    let copyText: String?
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            title: title,
            systemImage: systemImage,
            copyText: copyText,
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
        context.coordinator.copyText = copyText
        context.coordinator.isDisabled = isDisabled
        context.coordinator.cornerRadius = cornerRadius
        context.coordinator.action = action
        context.coordinator.hostView = uiView
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        weak var hostView: UIView?

        var title: String
        var systemImage: String
        var copyText: String?
        var isDisabled: Bool
        var cornerRadius: CGFloat
        var action: () -> Void

        init(
            title: String,
            systemImage: String,
            copyText: String?,
            isDisabled: Bool,
            cornerRadius: CGFloat,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.systemImage = systemImage
            self.copyText = copyText
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

                var children: [UIMenuElement] = []

                if let copyText = self.copyText,
                   !copyText.isEmpty {
                    let copyAction = UIAction(
                        title: "Copy",
                        image: UIImage(systemName: "doc.on.doc")
                    ) { _ in
                        UIPasteboard.general.string = copyText
                    }
                    children.append(copyAction)
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

                children.append(action)
                return UIMenu(children: children)
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
