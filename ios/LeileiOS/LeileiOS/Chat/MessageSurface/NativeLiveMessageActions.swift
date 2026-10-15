import SwiftUI
import UIKit

struct LightweightContextMenuInteraction: UIViewRepresentable {
    let title: String
    let copyText: String?
    let isDisabled: Bool
    let cornerRadius: CGFloat
    let onCopy: (String) -> Void
    var onTap: (() -> Void)? = nil
    let action: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            title: title,
            copyText: copyText,
            isDisabled: isDisabled,
            cornerRadius: cornerRadius,
            onCopy: onCopy,
            onTap: onTap,
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

        let tapRecognizer = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap)
        )
        view.addGestureRecognizer(tapRecognizer)

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
        context.coordinator.onCopy = onCopy
        context.coordinator.onTap = onTap
        context.coordinator.action = action
        context.coordinator.hostView = uiView
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        weak var hostView: UIView?

        var title: String
        var copyText: String?
        var isDisabled: Bool
        var cornerRadius: CGFloat
        var onCopy: (String) -> Void
        var onTap: (() -> Void)?
        var action: () -> Void

        init(
            title: String,
            copyText: String?,
            isDisabled: Bool,
            cornerRadius: CGFloat,
            onCopy: @escaping (String) -> Void,
            onTap: (() -> Void)?,
            action: @escaping () -> Void
        ) {
            self.title = title
            self.copyText = copyText
            self.isDisabled = isDisabled
            self.cornerRadius = cornerRadius
            self.onCopy = onCopy
            self.onTap = onTap
            self.action = action
        }

        @objc func handleTap() {
            onTap?()
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
                    ) { [weak self] _ in
                        self?.onCopy(copyText)
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


// The same UIKit context-menu interaction used by user bubbles, scoped to a
// *single* incoming iMessage text bubble. No row-wide gesture ownership.
struct IMessageAssistantBubbleContextMenuInteraction: UIViewRepresentable {
    let text: String
    let timestamp: String?
    let isRetryDisabled: Bool
    let cornerRadius: CGFloat
    let onCopy: (String) -> Void
    let onRetry: (() -> Void)?
    let onTranslate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(
            text: text,
            timestamp: timestamp,
            isRetryDisabled: isRetryDisabled,
            cornerRadius: cornerRadius,
            onCopy: onCopy,
            onRetry: onRetry,
            onTranslate: onTranslate
        )
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isOpaque = false
        view.addInteraction(UIContextMenuInteraction(delegate: context.coordinator))
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.text = text
        context.coordinator.timestamp = timestamp
        context.coordinator.isRetryDisabled = isRetryDisabled
        context.coordinator.cornerRadius = cornerRadius
        context.coordinator.onCopy = onCopy
        context.coordinator.onRetry = onRetry
        context.coordinator.onTranslate = onTranslate
    }

    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        var text: String
        var timestamp: String?
        var isRetryDisabled: Bool
        var cornerRadius: CGFloat
        var onCopy: (String) -> Void
        var onRetry: (() -> Void)?
        var onTranslate: () -> Void

        init(
            text: String,
            timestamp: String?,
            isRetryDisabled: Bool,
            cornerRadius: CGFloat,
            onCopy: @escaping (String) -> Void,
            onRetry: (() -> Void)?,
            onTranslate: @escaping () -> Void
        ) {
            self.text = text
            self.timestamp = timestamp
            self.isRetryDisabled = isRetryDisabled
            self.cornerRadius = cornerRadius
            self.onCopy = onCopy
            self.onRetry = onRetry
            self.onTranslate = onTranslate
        }

        func contextMenuInteraction(
            _ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint
        ) -> UIContextMenuConfiguration? {
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }

            return UIContextMenuConfiguration(
                identifier: nil,
                previewProvider: nil
            ) { [weak self] _ in
                guard let self else { return UIMenu(children: []) }
                let original = self.text
                var actions: [UIMenuElement] = [
                    UIAction(title: "Copy", image: nil) { [weak self] _ in
                        self?.onCopy(original)
                    }
                ]

                if self.onRetry != nil {
                    let retry = UIAction(
                        title: "Retry",
                        image: nil,
                        attributes: self.isRetryDisabled ? [.disabled] : []
                    ) { [weak self] _ in
                        self?.onRetry?()
                    }
                    actions.append(retry)
                }

                actions.append(
                    UIAction(title: "Translate", image: nil) { [weak self] _ in
                        self?.onTranslate()
                    }
                )

                // UIKit renders an inline-menu title as subdued, secondary
                // section metadata. It is neither a tappable action nor a
                // separate on-screen timestamp below the message.
                if let stamp = self.timestamp, !stamp.isEmpty {
                    return UIMenu(children: [
                        UIMenu(title: stamp, options: .displayInline, children: actions)
                    ])
                }
                return UIMenu(children: actions)
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

        private func preview(for interaction: UIContextMenuInteraction) -> UITargetedPreview? {
            guard let view = interaction.view else { return nil }
            let previewView = view.superview ?? view
            let params = UIPreviewParameters()
            params.backgroundColor = .clear
            params.visiblePath = UIBezierPath(
                roundedRect: previewView.bounds,
                cornerRadius: cornerRadius
            )
            params.shadowPath = UIBezierPath()
            return UITargetedPreview(view: previewView, parameters: params)
        }
    }
}


private struct NativeLiveCopyFeedbackActionKey: EnvironmentKey {
    static let defaultValue: (String) -> Void = { _ in }
}

extension EnvironmentValues {
    var nativeLiveCopyFeedback: (String) -> Void {
        get { self[NativeLiveCopyFeedbackActionKey.self] }
        set { self[NativeLiveCopyFeedbackActionKey.self] = newValue }
    }
}
