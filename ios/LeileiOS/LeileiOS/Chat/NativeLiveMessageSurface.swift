import SwiftUI
import UIKit

enum NativeLivePendingOperation: Equatable {
    case send(id: UUID, text: String)
    case retry(targetUserMessageID: String)
    case edit(targetUserMessageID: String, text: String)

    var scrollIdentity: String {
        switch self {
        case .send(let id, _):
            return "send-\(id.uuidString)"
        case .retry(let targetUserMessageID):
            return "retry-\(targetUserMessageID)"
        case .edit(let targetUserMessageID, _):
            return "edit-\(targetUserMessageID)"
        }
    }
}

struct NativeLiveMessageSurface: View {
    let snapshot: NativeLiveCurrentPathSnapshot?
    let syncState: AppModel.ChatSyncState
    let isAuthenticated: Bool
    let hasActiveConversation: Bool
    let isTurnInFlight: Bool
    let pendingOperation: NativeLivePendingOperation?
    let onRefresh: () async -> Void
    let onRetryMessage: (String) -> Void
    let onEditMessage: (NativeLiveCurrentPathMessage) -> Void

    private let bottomAnchorID = "native-live-chat-bottom"
    @State private var isAwayFromBottom = false
    @State private var copiedMessageID: String?
    @State private var copyFeedbackToken = UUID()

    var body: some View {
        Group {
            if !isAuthenticated {
                AppStateSurface(title: "Sign in")
            } else if pendingOperation != nil {
                messageList(snapshot)
            } else if !hasActiveConversation {
                AppStateSurface(title: "Nothing here")
            } else if let snapshot {
                if snapshot.messages.isEmpty {
                    Color.clear
                } else {
                    messageList(snapshot)
                }
            } else {
                switch syncState {
                case .idle, .loading:
                    Color.clear

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
        _ snapshot: NativeLiveCurrentPathSnapshot?
    ) -> some View {
        let messages = displayedMessages(
            snapshot?.messages ?? []
        )

        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 21) {
                    ForEach(messages) { message in
                        NativeLiveMessageRow(
                            message: message,
                            displayTextOverride:
                                editedTextOverride(for: message),
                            isTurnInFlight: isTurnInFlight,
                            isCopied: copiedMessageID == message.id,
                            onCopyMessage: { text in
                                copyMessage(
                                    text,
                                    messageID: message.id
                                )
                            },
                            onRetryMessage: onRetryMessage,
                            onEditMessage: onEditMessage
                        )
                        .id(message.id)
                    }

                    if let pendingOperation {
                        if case .send(_, let text) = pendingOperation {
                            NativeLiveOptimisticUserRow(text: text)
                                .id(
                                    "pending-user-"
                                        + pendingOperation.scrollIdentity
                                )
                        }

                        AssistantTypingIndicatorRow()
                            .id(
                                "pending-assistant-"
                                    + pendingOperation.scrollIdentity
                            )
                    }

                    Color.clear
                        .frame(height: 1)
                        .id(bottomAnchorID)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 8)
            }
            .id(
                snapshot?.conversationId
                    ?? pendingOperation?.scrollIdentity
                    ?? "native-live-empty"
            )
            .defaultScrollAnchor(.bottom, for: .initialOffset)
            .defaultScrollAnchor(.top, for: .alignment)
            .refreshable {
                await onRefresh()
            }
            .onChange(of: snapshot?.conversationId) { _, _ in
                isAwayFromBottom = false
            }
            .onChange(of: pendingOperation) { _, operation in
                guard operation != nil else { return }
                scrollToBottom(proxy)
            }
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.visibleRect.maxY
                    < geometry.contentSize.height - 12
            } action: { _, awayFromBottom in
                guard awayFromBottom != isAwayFromBottom else {
                    return
                }

                withAnimation(.easeInOut(duration: 0.16)) {
                    isAwayFromBottom = awayFromBottom
                }
            }
            .onChange(of: snapshot?.syncToken) { _, _ in
                scrollToBottom(proxy)
            }
            .overlay(alignment: .top) {
                if copiedMessageID != nil {
                    Text("Message copied")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 14)
                        .frame(height: 34)
                        .glassEffect(
                            .regular,
                            in: Capsule()
                        )
                        .padding(.top, 10)
                        .transition(
                            .move(edge: .top)
                                .combined(with: .opacity)
                        )
                }
            }
            .overlay(alignment: .bottom) {
                if isAwayFromBottom {
                    Button {
                        isAwayFromBottom = false
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

    private func displayedMessages(
        _ messages: [NativeLiveCurrentPathMessage]
    ) -> [NativeLiveCurrentPathMessage] {
        guard let pendingOperation else {
            return messages
        }

        let targetUserMessageID: String?
        switch pendingOperation {
        case .send:
            targetUserMessageID = nil
        case .retry(let target):
            targetUserMessageID = target
        case .edit(let target, _):
            targetUserMessageID = target
        }

        guard let targetUserMessageID,
              let targetIndex = messages.firstIndex(where: {
                  $0.id == targetUserMessageID
                      && $0.role == "user"
              }) else {
            return messages
        }

        return Array(messages.prefix(through: targetIndex))
    }

    private func editedTextOverride(
        for message: NativeLiveCurrentPathMessage
    ) -> String? {
        guard let pendingOperation,
              case .edit(
                  let targetUserMessageID,
                  let text
              ) = pendingOperation,
              message.id == targetUserMessageID else {
            return nil
        }

        return text
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
        isAwayFromBottom = false
        Task { @MainActor in
            await Task.yield()
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }
    }
}


private struct NativeLiveMessageRow: View {
    let message: NativeLiveCurrentPathMessage
    let displayTextOverride: String?
    let isTurnInFlight: Bool
    let isCopied: Bool
    let onCopyMessage: (String) -> Void
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
                        .padding(.vertical, 12)
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
        } else if message.status == "pending"
                    || message.status == "streaming" {
            AssistantTypingIndicatorRow()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(MessageTimestampFormatter.string(
                    from: message.completedAt ?? message.createdAt
                ))
                    .font(.system(size: 13.5))
                    .tracking(0.12)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                messageContent
                    .textSelection(.enabled)

                messageStatus

                HStack(spacing: 12) {
                    if let copyText {
                        Button {
                            onCopyMessage(copyText)
                        } label: {
                            Image(
                                systemName:
                                    isCopied
                                    ? "checkmark"
                                    : "square.on.square"
                            )
                            .frame(width: 22, height: 22)
                        }
                    }

                    if let targetUserMessageID = message.parentMessageId {
                        Button {
                            onRetryMessage(targetUserMessageID)
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .rotationEffect(.degrees(45))
                                .frame(width: 22, height: 22)
                        }
                        .disabled(isTurnInFlight)
                    }
                }
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(.secondary)
                .buttonStyle(.plain)
                .padding(.top, 7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        if let override = normalizedText(displayTextOverride) {
            ChatMarkdownView(
                text: override,
                fillsAvailableWidth: message.role != "user",
                lineSpacing: message.role == "user" ? 5 : 6,
                paragraphSpacing: message.role == "user" ? 19 : 22
            )
        } else {
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
            VStack(
                alignment: .leading,
                spacing: message.role == "user" ? 19 : 22
            ) {
                ForEach(visibleBlocks) { block in
                    NativeLiveBlockView(
                        block: block,
                        fillsAvailableWidth: message.role != "user",
                        isUserMessage: message.role == "user"
                    )
                }
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
        if let override = normalizedText(displayTextOverride) {
            return override
        }

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

private struct NativeLiveOptimisticUserRow: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Spacer(minLength: 48)

            ChatMarkdownView(
                text: text,
                fillsAvailableWidth: false,
                lineSpacing: 5,
                paragraphSpacing: 19
            )
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                Color.chatSoftFill,
                in: RoundedRectangle(
                    cornerRadius: 18,
                    style: .continuous
                )
            )
        }
    }
}


private struct AssistantTypingIndicatorRow: View {
    var body: some View {
        TimelineView(
            .animation(minimumInterval: 0.18)
        ) { context in
            let phase = Int(
                context.date.timeIntervalSinceReferenceDate / 0.18
            ) % 3

            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(
                            Color.secondary.opacity(
                                phase == index ? 0.82 : 0.24
                            )
                        )
                        .frame(width: 5, height: 5)
                        .scaleEffect(
                            phase == index ? 1.08 : 0.92
                        )
                }
            }
            .frame(height: 22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}


private struct LightweightContextMenuInteraction: UIViewRepresentable {
    let title: String
    let copyText: String?
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            title: title,
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
        context.coordinator.copyText = copyText
        context.coordinator.isDisabled = isDisabled
        context.coordinator.cornerRadius = cornerRadius
        context.coordinator.action = action
        context.coordinator.hostView = uiView
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        weak var hostView: UIView?

        var title: String
        var copyText: String?
        var isDisabled: Bool
        var cornerRadius: CGFloat
        var action: () -> Void

        init(
            title: String,
            copyText: String?,
            isDisabled: Bool,
            cornerRadius: CGFloat,
            action: @escaping () -> Void
        ) {
            self.title = title
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
                        image: nil
                    ) { _ in
                        UIPasteboard.general.string = copyText
                    }
                    children.append(copyAction)
                }

                let attributes: UIMenuElement.Attributes =
                    self.isDisabled ? [.disabled] : []

                let action = UIAction(
                    title: self.title,
                    image: nil,
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
    let isUserMessage: Bool

    var body: some View {
        if let text = normalizedText {
            switch block.kind {
            case "text":
                ChatMarkdownView(
                    text: text,
                    fillsAvailableWidth: fillsAvailableWidth,
                    lineSpacing: isUserMessage ? 5 : 6,
                    paragraphSpacing: isUserMessage ? 19 : 22
                )

            case "tool_use", "tool_result", "attachment":
                Text(text)
                    .font(.system(size: 15))
                    .tracking(0.10)
                    .lineSpacing(isUserMessage ? 5 : 6)
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


private struct ChatMarkdownView: View {
    let text: String
    let fillsAvailableWidth: Bool
    let lineSpacing: CGFloat
    let paragraphSpacing: CGFloat

    private let baseFontSize: CGFloat = 17

    var body: some View {
        VStack(alignment: .leading, spacing: paragraphSpacing) {
            ForEach(
                Array(ChatMarkdownParser.blocks(from: text).enumerated()),
                id: \.offset
            ) { _, block in
                blockView(block)
            }
        }
        .frame(
            maxWidth: fillsAvailableWidth ? .infinity : nil,
            alignment: .leading
        )
    }

    @ViewBuilder
    private func blockView(
        _ block: ChatMarkdownBlock
    ) -> some View {
        switch block {
        case .paragraph(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)

        case .heading(let level, let text):
            inlineText(text)
                .font(.system(
                    size: headingSize(level),
                    weight: level <= 2 ? .semibold : .medium
                ))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .padding(.top, level == 1 ? 2 : 0)

        case .quote(let text):
            inlineText(text)
                .font(.system(size: baseFontSize))
                .tracking(0.10)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.primary.opacity(0.20))
                        .frame(width: 2)
                }

        case .unorderedItem(let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("•")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .orderedItem(let number, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(number).")
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .foregroundStyle(.secondary)

                inlineText(text)
                    .font(.system(size: baseFontSize))
                    .tracking(0.10)
                    .lineSpacing(lineSpacing)
            }

        case .codeBlock(let code):
            Text(code)
                .font(.system(size: 14, design: .monospaced))
                .tracking(0.08)
                .lineSpacing(lineSpacing)
                .foregroundStyle(.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.primary.opacity(0.055),
                    in: RoundedRectangle(
                        cornerRadius: 10,
                        style: .continuous
                    )
                )

        case .divider:
            Divider()
                .opacity(0.55)
        }
    }

    private func inlineText(_ source: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: source,
            options: .init(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        ) {
            return Text(attributed)
        }

        return Text(source)
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1:
            return 20.5
        case 2:
            return 18.5
        case 3:
            return 17.5
        default:
            return 17
        }
    }
}

private enum ChatMarkdownBlock {
    case paragraph(String)
    case heading(level: Int, text: String)
    case quote(String)
    case unorderedItem(String)
    case orderedItem(number: Int, text: String)
    case codeBlock(String)
    case divider
}

private enum ChatMarkdownParser {
    static func blocks(
        from source: String
    ) -> [ChatMarkdownBlock] {
        let lines = source.components(separatedBy: .newlines)
        var result: [ChatMarkdownBlock] = []
        var paragraph: [String] = []
        var codeLines: [String] = []
        var isInCodeBlock = false

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            result.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph.removeAll(keepingCapacity: true)
        }

        func flushCodeBlock() {
            result.append(.codeBlock(codeLines.joined(separator: "\n")))
            codeLines.removeAll(keepingCapacity: true)
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") {
                flushParagraph()

                if isInCodeBlock {
                    flushCodeBlock()
                    isInCodeBlock = false
                } else {
                    isInCodeBlock = true
                }
                continue
            }

            if isInCodeBlock {
                codeLines.append(line)
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if trimmed == "---"
                || trimmed == "***"
                || trimmed == "___" {
                flushParagraph()
                result.append(.divider)
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                result.append(
                    .heading(
                        level: heading.level,
                        text: heading.text
                    )
                )
                continue
            }

            if trimmed.hasPrefix("> ") {
                flushParagraph()
                result.append(
                    .quote(String(trimmed.dropFirst(2)))
                )
                continue
            }

            if let item = unorderedItem(from: trimmed) {
                flushParagraph()
                result.append(.unorderedItem(item))
                continue
            }

            if let item = orderedItem(from: trimmed) {
                flushParagraph()
                result.append(
                    .orderedItem(
                        number: item.number,
                        text: item.text
                    )
                )
                continue
            }

            paragraph.append(line)
        }

        flushParagraph()

        if isInCodeBlock || !codeLines.isEmpty {
            flushCodeBlock()
        }

        return result
    }

    private static func heading(
        from line: String
    ) -> (level: Int, text: String)? {
        let level = line.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else {
            return nil
        }

        let index = line.index(
            line.startIndex,
            offsetBy: level
        )
        guard index < line.endIndex,
              line[index] == " " else {
            return nil
        }

        let text = String(line[line.index(after: index)...])
        return (level, text)
    }

    private static func unorderedItem(
        from line: String
    ) -> String? {
        for prefix in ["- ", "* ", "+ "] {
            if line.hasPrefix(prefix) {
                return String(line.dropFirst(prefix.count))
            }
        }

        return nil
    }

    private static func orderedItem(
        from line: String
    ) -> (number: Int, text: String)? {
        guard let dot = line.firstIndex(of: ".") else {
            return nil
        }

        let numberText = line[..<dot]
        guard let number = Int(numberText) else {
            return nil
        }

        let afterDot = line.index(after: dot)
        guard afterDot < line.endIndex,
              line[afterDot] == " " else {
            return nil
        }

        let textStart = line.index(after: afterDot)
        return (
            number,
            String(line[textStart...])
        )
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
