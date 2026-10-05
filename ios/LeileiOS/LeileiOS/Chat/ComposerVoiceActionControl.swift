import SwiftUI
import UIKit

struct NativeLiveVoiceActionControl: UIViewRepresentable {
    @Binding var voiceLanguage: VoiceInputLanguage
    let isEnabled: Bool
    let onInteractionBegin: () -> Void
    let onVoicePress: () -> Void
    let onVoiceRelease: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(
        context: Context
    ) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .clear
        view.isOpaque = false

        let longPress = UILongPressGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleLongPress(_:))
        )
        longPress.minimumPressDuration = 0.35
        longPress.allowableMovement = 50

        let tap = UITapGestureRecognizer(
            target: context.coordinator,
            action: #selector(Coordinator.handleTap(_:))
        )
        tap.require(toFail: longPress)

        view.addGestureRecognizer(longPress)
        view.addGestureRecognizer(tap)

        let editMenu = UIEditMenuInteraction(
            delegate: context.coordinator
        )
        view.addInteraction(editMenu)
        context.coordinator.editMenuInteraction = editMenu

        return view
    }

    func updateUIView(
        _ view: UIView,
        context: Context
    ) {
        context.coordinator.parent = self
        view.isUserInteractionEnabled = isEnabled
        view.isAccessibilityElement = true
        view.accessibilityLabel =
            "Voice input, "
            + voiceLanguage.displayName
            + ". Tap to choose language, hold to dictate and send"
    }

    final class Coordinator:
        NSObject,
        UIEditMenuInteractionDelegate {
        var parent: NativeLiveVoiceActionControl
        weak var editMenuInteraction: UIEditMenuInteraction?
        private var voiceHoldActive = false

        init(
            parent: NativeLiveVoiceActionControl
        ) {
            self.parent = parent
        }

        @objc func handleTap(
            _ recognizer: UITapGestureRecognizer
        ) {
            guard parent.isEnabled,
                  recognizer.state == .ended,
                  let editMenuInteraction,
                  let view = recognizer.view else {
                return
            }

            parent.onInteractionBegin()

            let configuration = UIEditMenuConfiguration(
                identifier: nil,
                sourcePoint: CGPoint(
                    x: view.bounds.midX,
                    y: view.bounds.midY
                )
            )
            editMenuInteraction.presentEditMenu(
                with: configuration
            )
        }

        @objc func handleLongPress(
            _ recognizer: UILongPressGestureRecognizer
        ) {
            guard parent.isEnabled else { return }

            switch recognizer.state {
            case .began:
                parent.onInteractionBegin()
                voiceHoldActive = true
                parent.onVoicePress()

            case .ended, .cancelled, .failed:
                guard voiceHoldActive else { return }
                voiceHoldActive = false
                parent.onVoiceRelease()

            default:
                break
            }
        }

        func editMenuInteraction(
            _ interaction: UIEditMenuInteraction,
            menuFor configuration: UIEditMenuConfiguration,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            let actions = VoiceInputLanguage.allCases.map {
                language in
                UIAction(
                    title: language.displayName,
                    state:
                        language == parent.voiceLanguage
                            ? .on
                            : .off
                ) { [weak self] _ in
                    self?.parent.voiceLanguage = language
                }
            }

            return UIMenu(
                title: "Voice language",
                children: actions
            )
        }
    }
}
